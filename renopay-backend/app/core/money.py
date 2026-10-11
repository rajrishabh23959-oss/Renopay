"""
Single source of truth for money conversions. The DB and all internal
logic use integer paise; only the API boundary (request/response JSON)
speaks rupees, and only through these functions — never inline
`* 100` or `/ 100` anywhere else in the codebase.
"""
import secrets
import uuid
from decimal import Decimal, ROUND_HALF_UP


def rupees_to_paise(rupees: float | int | str | Decimal) -> int:
    """
    Convert rupees to integer paise.
    Safely handles float precision anomalies (e.g., 0.1 + 0.2), scientific notation,
    strings, Decimals, negative values, and rounds to nearest integer paise.
    """
    if isinstance(rupees, (int, str)):
        d = Decimal(str(rupees))
    elif isinstance(rupees, float):
        d = Decimal(f"{rupees:.4f}")
    elif isinstance(rupees, Decimal):
        d = rupees
    else:
        d = Decimal(str(rupees))

    return int((d * Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def paise_to_rupees(paise: int) -> float:
    """Convert integer paise to float rupees rounded to 2 decimal places."""
    return round(paise / 100, 2)


def round_up_paise(amount_paise: int, multiple_paise: int = 1000) -> int:
    """
    Calculates paise needed to round up to the nearest multiple (default ₹10 = 1000 paise).
    Returns 0 if already an exact multiple or amount <= 0.
    """
    if amount_paise <= 0 or multiple_paise <= 0:
        return 0
    rem = amount_paise % multiple_paise
    return 0 if rem == 0 else multiple_paise - rem


def format_inr(paise: int, include_symbol: bool = True) -> str:
    """
    Formats integer paise into Indian numbering system currency string (e.g. ₹1,23,456.78).
    Handles zero, negative values, and lakh/crore formatting.
    """
    is_negative = paise < 0
    abs_paise = abs(paise)
    rupees = abs_paise // 100
    fraction = abs_paise % 100

    s = str(rupees)
    if len(s) > 3:
        last3 = s[-3:]
        rest = s[:-3]
        groups = []
        while len(rest) > 2:
            groups.insert(0, rest[-2:])
            rest = rest[:-2]
        if rest:
            groups.insert(0, rest)
        formatted_rupees = ",".join(groups) + "," + last3
    else:
        formatted_rupees = s

    formatted = f"{formatted_rupees}.{fraction:02d}"
    prefix = ("-" if is_negative else "") + ("₹" if include_symbol else "")
    return f"{prefix}{formatted}"


def generate_txn_ref() -> str:
    suffix = secrets.token_hex(6).upper()
    return f"RENO-TXN-{suffix}"


def generate_virtual_acc_no() -> str:
    return f"41110{secrets.randbelow(10000000):07d}"


def new_txn_group_id() -> uuid.UUID:
    return uuid.uuid4()
