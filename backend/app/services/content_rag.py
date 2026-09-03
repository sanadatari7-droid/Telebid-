"""AI Content Library — retrieval-augmented answer drafting.

Retrieval uses PostgreSQL's pg_trgm similarity() against the library's
`question` column (the extension is already enabled at the top of
database/schema.sql) — no vector database or embeddings pipeline needed
for a library this size. Claude then drafts an answer to a new question,
grounded ONLY in the retrieved past answers, so it never invents facts
the company hasn't actually stated before.

Same graceful-degradation contract as ai_advisor.py: is_configured()
gates callers before draft_answer() is invoked.
"""
import logging
from typing import List

from pydantic import BaseModel, Field

from app.core.config import settings

logger = logging.getLogger(__name__)

TOP_N = 5


class DraftedAnswer(BaseModel):
    answer: str = Field(description="The drafted answer, grounded in the source snippets given")
    grounded: bool = Field(description="True if the library actually contained enough relevant material to answer confidently; False if the draft is mostly a best-effort guess")


def is_configured() -> bool:
    return bool(settings.ANTHROPIC_API_KEY)


async def retrieve_similar(conn, company_id: int, question: str, limit: int = TOP_N) -> List[dict]:
    """Top-N library items whose question is most similar to the given one,
    via pg_trgm trigram similarity (threshold-free — always returns the best
    matches available, ranked, even if similarity is low)."""
    from app.db.postgres import fetch_all
    rows = await fetch_all(conn, """
        SELECT item_id, question, answer, category, tags,
               similarity(question, $2) AS score
        FROM content_library_items
        WHERE company_id = $1
        ORDER BY score DESC
        LIMIT $3
    """, company_id, question, limit)
    return [dict(r) for r in rows]


def _build_prompt(question: str, snippets: List[dict]) -> str:
    lines = [
        "Draft an answer to this new RFP/tender question, using ONLY the source snippets",
        "below (past answers this company has given to similar questions) as grounding.",
        "Adapt and combine them as needed, but do not invent facts, certifications, or",
        "numbers that aren't in the snippets. If the snippets don't actually cover what's",
        "being asked, say so plainly in the answer and set grounded=false.",
        "",
        f"## New question\n{question}",
        "",
        "## Source snippets (past company answers, ranked by relevance)",
    ]
    if not snippets:
        lines.append("(none found — the content library has no similar past answers)")
    for s in snippets:
        lines.append(f"- Q: {s['question']}\n  A: {s['answer']}")
    return "\n".join(lines)


async def draft_answer(conn, company_id: int, question: str) -> dict:
    if not is_configured():
        raise RuntimeError("Content library AI drafting not configured: set ANTHROPIC_API_KEY")

    import anthropic

    snippets = await retrieve_similar(conn, company_id, question)
    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    response = await client.messages.parse(
        model=settings.ANTHROPIC_MODEL,
        max_tokens=1536,
        system=(
            "You draft RFP/tender responses for a telecom and ICT systems integrator, "
            "reusing the company's own past answers rather than generic filler."
        ),
        messages=[{"role": "user", "content": _build_prompt(question, snippets)}],
        output_format=DraftedAnswer,
    )
    result = response.parsed_output.model_dump()
    result["sources"] = snippets
    return result
