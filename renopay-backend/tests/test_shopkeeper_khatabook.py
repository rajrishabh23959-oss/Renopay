import pytest
from app.routers.voicebox import build_announcement_text
from app.routers.khatabook import parse_voice_entry, VoiceParseRequest
from app.services.gold_service import PURCHASE_THRESHOLD_PAISE


def test_build_announcement_text_multilingual():
    # Hindi
    hi_txt = build_announcement_text("hi", sender_name="Praveen", amount=100.0, current_balance=5420.0, include_balance=True)
    assert "Praveen" in hi_txt
    assert "100" in hi_txt
    assert "RenoPay par" in hi_txt
    assert "₹5,420" in hi_txt

    # English
    en_txt = build_announcement_text("en", sender_name="Praveen", amount=100.0, current_balance=5420.0, include_balance=True)
    assert "Received 100 rupees from Praveen on RenoPay" in en_txt

    # Bhojpuri
    bho_txt = build_announcement_text("bho", sender_name="Praveen", amount=100.0, current_balance=5420.0, include_balance=True)
    assert "milal ba" in bho_txt

    # Tamil
    ta_txt = build_announcement_text("ta", sender_name="Praveen", amount=100.0, current_balance=5420.0, include_balance=True)
    assert "rubai perappattadhu" in ta_txt

    # Telugu
    te_txt = build_announcement_text("te", sender_name="Praveen", amount=100.0, current_balance=5420.0, include_balance=True)
    assert "rupayalu andukunnam" in te_txt

    # Malayalam
    ml_txt = build_announcement_text("ml", sender_name="Praveen", amount=100.0, current_balance=5420.0, include_balance=True)
    assert "roopa labhichu" in ml_txt

    # Marathi
    mr_txt = build_announcement_text("mr", sender_name="Praveen", amount=100.0, current_balance=5420.0, include_balance=True)
    assert "prapta jhale" in mr_txt

    # Bengali
    bn_txt = build_announcement_text("bn", sender_name="Praveen", amount=100.0, current_balance=5420.0, include_balance=True)
    assert "taka pawa geche" in bn_txt


def test_gold_pot_threshold_constant():
    assert PURCHASE_THRESHOLD_PAISE == 20000  # ₹200 threshold before bulk gold buy fires
