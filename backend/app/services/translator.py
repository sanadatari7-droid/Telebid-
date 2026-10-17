"""English <-> Arabic for client names, billing addresses and short labels.

Works both ways: type in English and the Arabic is filled in, or type in Arabic
and the English is filled in. Names are rendered the way the person or
organisation writes them in the other language (Sanad <-> سند, Ministry of
Health <-> وزارة الصحة), not translated word for word; addresses are translated
normally, keeping numbers, codes and building/PO box identifiers intact.
The result is a suggestion: users can always edit it.
"""
import logging
import re
from typing import Literal

import anthropic
from pydantic import BaseModel, Field

from app.core.config import settings

logger = logging.getLogger(__name__)

TextKind = Literal["name", "address", "label"]
Language = Literal["ar", "en"]

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


_INSTRUCTIONS_EN = {
    "name": (
        "This is the name of a client: a person, company or government entity, written in Arabic. "
        "Write it as it would appear in English. For a person's name or a brand, give its usual "
        "English spelling (e.g. 'سند' -> 'Sanad', 'مايكروسوفت' -> 'Microsoft'). For an entity with "
        "an official English name (e.g. 'وزارة الصحة' -> 'Ministry of Health'), use that name."
    ),
    "address": (
        "This is a billing address written in Arabic. Translate it into English as it would be written "
        "on an English invoice. Keep building numbers, PO box numbers, postal codes and unit numbers as digits."
    ),
    "label": (
        "This is a short Arabic label from a list of ICT services or products. Translate it into the "
        "English term used in the industry; keep brand names and acronyms as they are."
    ),
}


class _ArabicText(BaseModel):
    arabic: str = Field(description="The Arabic text only, with no explanation, quotes or transliteration notes")


class _EnglishText(BaseModel):
    english: str = Field(description="The English text only, with no explanation, quotes or notes")


def is_configured() -> bool:
    return bool(settings.ANTHROPIC_API_KEY)


_ARABIC_LETTERS = re.compile(r"[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]")


def detect_language(text: str) -> Language:
    """'ar' when the text is mostly Arabic letters, else 'en'."""
    arabic = len(_ARABIC_LETTERS.findall(text))
    latin = len(re.findall(r"[A-Za-z]", text))
    return "ar" if arabic > latin else "en"


async def translate_to_arabic(text: str, kind: TextKind) -> str:
    return await translate(text, kind, "ar")


async def translate(text: str, kind: TextKind, to: Language) -> str:
    """Translate into `to` ("ar" or "en")."""
    other = "Arabic" if to == "ar" else "English"
    if not is_configured():
        raise TranslationUnavailable(f"Automatic translation isn't set up (no AI key configured). Type the {other} yourself.")

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
                ("You convert English text into Arabic" if to == "ar" else "You convert Arabic text into English")
                + " for a bid and tender management system used by a company in the Gulf region. "
                + (_INSTRUCTIONS if to == "ar" else _INSTRUCTIONS_EN)[kind]
            ),
            messages=[{"role": "user", "content": text}],
            output_format=_ArabicText if to == "ar" else _EnglishText,
        )
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as e:
        logger.error("Translation API key rejected: %s", e.message)
        raise TranslationUnavailable("Automatic translation isn't working: the AI key was rejected. "
                                     "Ask your administrator to update it, and type it yourself for now.")
    except anthropic.RateLimitError:
        raise TranslationUnavailable("Translation is busy right now. Try again in a moment, or type it yourself.")
    except anthropic.APIStatusError as e:
        logger.error("Translation API error %s: %s", e.status_code, e.message)
        raise TranslationUnavailable("Translation failed. Try again, or type it yourself.")
    except anthropic.APIConnectionError:
        logger.error("Translation API unreachable")
        raise TranslationUnavailable("Translation service couldn't be reached. Type it yourself.")

    if response.stop_reason == "refusal" or response.parsed_output is None:
        raise TranslationUnavailable("No translation was produced for this text. Type it yourself.")
    out = response.parsed_output
    return (out.arabic if to == "ar" else out.english).strip()
