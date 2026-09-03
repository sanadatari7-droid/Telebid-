"""RFP Requirement Extraction.

Given the raw text of an RFP/tender document (pasted, not parsed from a
file — no PDF/DOCX parsing library is wired up), asks Claude to pull out
every distinct requirement the customer is asking for and classify it,
so it can be tracked as a compliance-matrix row (met / not met / needs
work) instead of someone re-reading the whole document by hand.

Same graceful-degradation contract as app/services/ai_advisor.py:
is_configured() gates callers before extract() is ever invoked.
"""
import logging
from typing import List

from pydantic import BaseModel, Field

from app.core.config import settings

logger = logging.getLogger(__name__)

MAX_RFP_CHARS = 60000  # keep prompt + output comfortably inside the model's context/output budget


class ExtractedRequirement(BaseModel):
    category: str = Field(description="One short category: Technical, Commercial, Legal, Eligibility, Timeline, or Other")
    requirement_text: str = Field(description="The requirement itself, one clear sentence, in the RFP's own terms")


class ExtractionResult(BaseModel):
    requirements: List[ExtractedRequirement]


def is_configured() -> bool:
    return bool(settings.ANTHROPIC_API_KEY)


async def extract(rfp_text: str) -> List[dict]:
    if not is_configured():
        raise RuntimeError("Requirement extraction not configured: set ANTHROPIC_API_KEY")

    import anthropic

    text = rfp_text.strip()[:MAX_RFP_CHARS]
    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    prompt = (
        "Extract every distinct requirement from the RFP/tender text below into a "
        "compliance-matrix-ready list. A requirement is anything the customer is asking "
        "the bidder to have, do, provide, or comply with (technical specs, certifications, "
        "experience thresholds, submission format rules, legal terms, deadlines, etc). "
        "Do not summarize or merge unrelated requirements together — one row per requirement. "
        "Skip pure narrative/background text that isn't asking for anything.\n\n"
        f"--- RFP TEXT ---\n{text}\n--- END RFP TEXT ---"
    )
    response = await client.messages.parse(
        model=settings.ANTHROPIC_MODEL,
        max_tokens=8192,
        system=(
            "You build compliance matrices for telecom/ICT tender responses. Be thorough "
            "and literal — extract what the document actually asks for, never invent "
            "requirements that aren't there."
        ),
        messages=[{"role": "user", "content": prompt}],
        output_format=ExtractionResult,
    )
    return [r.model_dump() for r in response.parsed_output.requirements]
