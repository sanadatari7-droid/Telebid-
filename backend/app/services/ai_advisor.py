"""AI Bid/No-Bid Advisor.

Calls Claude to produce a structured bid/no-bid recommendation for an
opportunity, grounded in the opportunity's own data plus this company's
historical win/loss record with the same customer and service line.

Requires ANTHROPIC_API_KEY to be set (see app/core/config.py). When it isn't,
is_configured() returns False and callers should surface a clean "AI advisor
not configured" response rather than calling generate_recommendation().
"""
import logging
from typing import List

from pydantic import BaseModel, Field

from app.core.config import settings

logger = logging.getLogger(__name__)


class BidAdvisorResult(BaseModel):
    recommendation: str = Field(description="One of: BID, NO_BID, CONDITIONAL_BID")
    confidence: int = Field(description="0-100 confidence in this recommendation call itself")
    win_probability: int = Field(description="0-100 estimated probability of winning this specific opportunity IF it is bid, independent of whether you recommend bidding it")
    key_strengths: List[str] = Field(description="Up to 5 short bullet points favoring a bid")
    key_risks: List[str] = Field(description="Up to 5 short bullet points against a bid, or conditions to satisfy")
    reasoning: str = Field(description="2-4 sentence explanation grounded in the data given")


def is_configured() -> bool:
    return bool(settings.ANTHROPIC_API_KEY)


def _build_prompt(opp: dict, history: dict) -> str:
    def pct(won, total):
        return f"{round(100 * won / total, 1)}%" if total else None

    cust_rate = pct(history.get("customer_won", 0), history.get("customer_total", 0))
    svc_rate = pct(history.get("service_won", 0), history.get("service_total", 0))

    lines = [
        "Evaluate this tender opportunity and recommend BID, NO_BID, or CONDITIONAL_BID.",
        "Base your recommendation ONLY on the data below — do not invent facts about",
        "the customer, competitors, or market that aren't given here. If information",
        "needed for a confident call is missing, say so as a risk rather than guessing.",
        "",
        "Separately from your recommendation, also estimate win_probability: the chance",
        "of actually winning THIS opportunity if the company does bid it, grounded mainly",
        "in the historical win rates given below (with this customer and in this service",
        "line) and any risk factors in the opportunity data itself. This is independent of",
        "the recommendation — e.g. a well-qualified opportunity can still recommend BID",
        "with a modest win_probability if the historical win rate here is low.",
        "",
        "## Opportunity",
        f"- Customer: {opp.get('customer_name')} "
        f"({opp.get('customer_type') or 'n/a'}{', strategic account' if opp.get('is_strategic') else ''})",
        f"- Source / project type: {opp.get('project_type') or 'n/a'}",
        f"- Service line: {opp.get('service_type') or 'n/a'}",
        f"- Total contract value (TCV): {opp.get('tcv') if opp.get('tcv') is not None else 'not provided'}",
        f"- NRC / MRC: {opp.get('nrc') if opp.get('nrc') is not None else 'n/a'} / "
        f"{opp.get('mrc') if opp.get('mrc') is not None else 'n/a'}",
        f"- Contract duration: {opp.get('contract_duration') or 'n/a'}",
        f"- Submission deadline: {opp.get('submission_deadline') or 'not set'}",
        f"- Bid bond required: {'yes' if opp.get('bond_required') else 'no'}",
        f"- Description: {opp.get('description') or 'none provided'}",
        f"- Scope of work: {opp.get('sow_detail') or 'none provided'}",
        "",
        "## This company's historical track record (source of truth — use this, not outside knowledge)",
        f"- With this customer: {history.get('customer_won', 0)} won / {history.get('customer_total', 0)} decided"
        + (f" ({cust_rate} win rate)" if cust_rate else " (no prior history with this customer)"),
        f"- In this service line: {history.get('service_won', 0)} won / {history.get('service_total', 0)} decided"
        + (f" ({svc_rate} win rate)" if svc_rate else " (no prior history in this service line)"),
    ]
    return "\n".join(lines)


async def generate_recommendation(opp: dict, history: dict) -> dict:
    if not is_configured():
        raise RuntimeError("AI advisor not configured: set ANTHROPIC_API_KEY")

    import anthropic

    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    prompt = _build_prompt(opp, history)

    response = await client.messages.parse(
        model=settings.ANTHROPIC_MODEL,
        max_tokens=2048,
        system=(
            "You are a bid/no-bid advisor for a telecom and ICT systems integrator "
            "evaluating tender opportunities before committing bid-preparation resources. "
            "Be candid and specific — a vague 'it depends' recommendation is not useful."
        ),
        messages=[{"role": "user", "content": prompt}],
        output_format=BidAdvisorResult,
    )
    return response.parsed_output.model_dump()
