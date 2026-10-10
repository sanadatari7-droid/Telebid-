"""English -> Arabic for client names and billing addresses.

Names are rendered the way the person or organisation would write them in
Arabic (Sanad -> سند), not translated word for word; addresses are translated
normally, keeping numbers, codes and building/PO box identifiers intact.
The result is a suggestion: users can always edit the Arabic.
"""
import logging
from typing import Literal

import anthropic
from pydantic import BaseModel, Field

from app.core.config import settings

logger = logging.getLogger(__name__)

TextKind = Literal["name", "address", "label"]

_INSTRUCTIONS = {
    "name": (
        "This is the name of a client: a person, company or government entity. "
        "Write it as it would appear in Arabic. For a person's name or a brand, give its usual "
        "Arabic spelling (e.g. 'Sanad' -> 'سند', 'Microsoft' -> 'مايكروسوفت'). For an entity with "
        "an official Arabic name (e.g. 'Ministry of Health' -> 'وزارة الصحة'), use that name."
    ),
    "address": (
        "This is a billing address. Translate it into Arabic as it would be written on an Arabic "
        "invoice. Keep building numbers, PO box numbers, postal codes and unit numbers as digits."
    ),
    "label": (
        "This is a short label from a list of ICT services or products. Translate it into the "
        "Arabic term used in the industry; keep brand names and acronyms (e.g. 'Cisco', 'SD-WAN') as they are."
    ),
}


class TranslationUnavailable(Exception):
    """The translation could not be produced; the message is safe to show to users."""


class _ArabicText(BaseModel):
    arabic: str = Field(description="The Arabic text only, with no explanation, quotes or transliteration notes")


def is_configured() -> bool:
    return bool(settings.ANTHROPIC_API_KEY)


async def translate_to_arabic(text: str, kind: TextKind) -> str:
    if not is_configured():
        raise TranslationUnavailable("Automatic translation isn't set up (no AI key configured). Type the Arabic yourself.")

    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    try:
        # Server-side fallback: if the model declines, the API re-runs the request on a fallback model.
        response = await client.beta.messages.parse(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "low"},  # a short translation needs little reasoning
            system=(
                "You convert English text into Arabic for a bid and tender management system "
                "used by a company in the Gulf region. " + _INSTRUCTIONS[kind]
            ),
            messages=[{"role": "user", "content": text}],
            output_format=_ArabicText,
        )
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as e:
        logger.error("Translation API key rejected: %s", e.message)
        raise TranslationUnavailable("Automatic translation isn't working: the AI key was rejected. "
                                     "Ask your administrator to update it, and type the Arabic yourself for now.")
    except anthropic.RateLimitError:
        raise TranslationUnavailable("Translation is busy right now. Try again in a moment, or type the Arabic yourself.")
    except anthropic.APIStatusError as e:
        logger.error("Translation API error %s: %s", e.status_code, e.message)
        raise TranslationUnavailable("Translation failed. Try again, or type the Arabic yourself.")
    except anthropic.APIConnectionError:
        logger.error("Translation API unreachable")
        raise TranslationUnavailable("Translation service couldn't be reached. Type the Arabic yourself.")

    if response.stop_reason == "refusal" or response.parsed_output is None:
        raise TranslationUnavailable("No translation was produced for this text. Type the Arabic yourself.")
    return response.parsed_output.arabic.strip()
