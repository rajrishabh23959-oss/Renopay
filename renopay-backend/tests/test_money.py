"""
Exhaustive and property-based test suite for RenoPay monetary core (app/core/money.py).
Verifies integer paise guarantees, float rounding safety, and Indian numbering currency formats.
"""
from decimal import Decimal
import pytest
from app.core.money import (
    rupees_to_paise,
    paise_to_rupees,
    round_up_paise,
    format_inr,
    generate_txn_ref,
    generate_virtual_acc_no,
    new_txn_group_id,
)


def test_rupees_to_paise_standard():
    assert rupees_to_paise(1) == 100
    assert rupees_to_paise(10.50) == 1050
    assert rupees_to_paise(0) == 0
    assert rupees_to_paise("100.25") == 10025
    assert rupees_to_paise(Decimal("99.99")) == 9999


def test_rupees_to_paise_float_precision_edge_cases():
    # Famous IEEE 754 float quirk: 0.1 + 0.2 is 0.30000000000000004
    assert rupees_to_paise(0.1 + 0.2) == 30
    assert rupees_to_paise(19.99) == 1999
    assert rupees_to_paise(0.01) == 1
    assert rupees_to_paise(0.009) == 1  # Rounds to nearest paisa
    assert rupees_to_paise(0.004) == 0


def test_rupees_to_paise_scientific_and_extremes():
    # Scientific notation
    assert rupees_to_paise(1e-5) == 0
    assert rupees_to_paise(1e2) == 10000

    # Negative values
    assert rupees_to_paise(-10) == -1000
    assert rupees_to_paise(-0.50) == -50

    # Huge integer (e.g., 100 Crore Rupees = 1,000,000,000 INR)
    huge_rupees = 1_000_000_000
    assert rupees_to_paise(huge_rupees) == 100_000_000_000


def test_paise_to_rupees_conversions():
    assert paise_to_rupees(0) == 0.0
    assert paise_to_rupees(100) == 1.00
    assert paise_to_rupees(1050) == 10.50
    assert paise_to_rupees(1) == 0.01
    assert paise_to_rupees(-500) == -5.00


def test_round_trip_property():
    test_values = [0, 1, 50, 100, 250, 1099, 999999, 100000000]
    for p in test_values:
        r = paise_to_rupees(p)
        assert rupees_to_paise(r) == p


def test_round_up_paise_logic():
    # Exact multiples return 0 (no round up necessary)
    assert round_up_paise(1000) == 0
    assert round_up_paise(2000) == 0
    assert round_up_paise(0) == 0
    assert round_up_paise(-500) == 0

    # Typical UPI transactions rounded to nearest ₹10 (1000 paise)
    assert round_up_paise(185) == 815       # ₹1.85 -> rounds to ₹10 (815 paise spare change)
    assert round_up_paise(999) == 1         # ₹9.99 -> rounds to ₹10 (1 paisa spare change)
    assert round_up_paise(1001) == 999      # ₹10.01 -> rounds to ₹20 (999 paise spare change)

    # Custom multiple (e.g. ₹100 = 10000 paise)
    assert round_up_paise(4500, multiple_paise=10000) == 5500


def test_format_inr_indian_numbering():
    # Zero and small amounts
    assert format_inr(0) == "₹0.00"
    assert format_inr(50) == "₹0.50"
    assert format_inr(185) == "₹1.85"

    # Thousands
    assert format_inr(100000) == "₹1,000.00"

    # Lakhs (₹1,00,000.00)
    assert format_inr(10000000) == "₹1,00,000.00"

    # Crores (₹1,00,00,000.00)
    assert format_inr(1000000000) == "₹1,00,00,000.00"

    # Without symbol
    assert format_inr(12345678, include_symbol=False) == "1,23,456.78"

    # Negative values
    assert format_inr(-5000) == "-₹50.00"
    assert format_inr(-5000, include_symbol=False) == "-50.00"


def test_generators_format():
    txn_ref = generate_txn_ref()
    assert txn_ref.startswith("RENO-TXN-")
    assert len(txn_ref) == len("RENO-TXN-") + 12

    van = generate_virtual_acc_no()
    assert van.startswith("41110")
    assert len(van) == 12

    group_id = new_txn_group_id()
    assert group_id is not None
