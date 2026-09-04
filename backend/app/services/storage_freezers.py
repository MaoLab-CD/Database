from __future__ import annotations

from decimal import Decimal


def format_temperature(value: Decimal | float | int | str) -> str:
    temperature = Decimal(str(value))
    text = format(temperature.normalize(), "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return f"{text} °C"


def build_freezer_label(
    freezer_code: str,
    temperature_c: Decimal | float | int | str,
) -> str:
    return f"{freezer_code} {format_temperature(temperature_c)}"
