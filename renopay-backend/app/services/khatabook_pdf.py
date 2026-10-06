"""
PDF Generation Service for RenoPay Khatabook & Shopkeeper Mode.
Supports:
1. Individual Customer Monthly Statement PDF (Date-wise itemized purchases & payments).
2. Full Month Sales & Business PDF Report (Turnover, Cash vs UPI, Udhar given vs collected, week-wise analytics).
"""
import io
import re
from datetime import datetime, timezone, timedelta, date
from jinja2 import Environment, BaseLoader

IST = timezone(timedelta(hours=5, minutes=30))

try:
    from weasyprint import HTML as WeasyprintHTML
    WEASYPRINT_AVAILABLE = True
except (ImportError, OSError):
    WEASYPRINT_AVAILABLE = False

try:
    from xhtml2pdf import pisa
    XHTML2PDF_AVAILABLE = True
except ImportError:
    XHTML2PDF_AVAILABLE = False


CUSTOMER_STATEMENT_TEMPLATE = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Customer Statement &mdash; {{ customer.name }}</title>
<style>
@page {
    size: A4 portrait;
    margin: 15mm 16mm;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: Helvetica, Arial, sans-serif;
    color: #1e293b;
    background: #ffffff;
    font-size: 11px;
    line-height: 1.4;
}
.header-table { width: 100%; border-bottom: 2px solid #FF6A1A; padding-bottom: 12px; margin-bottom: 16px; }
.brand { font-size: 22px; font-weight: bold; color: #162a45; }
.brand span { color: #FF6A1A; }
.doc-title { font-size: 13px; font-weight: bold; text-align: right; color: #64748b; text-transform: uppercase; letter-spacing: 1px; }

.card-summary {
    background-color: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 14px 16px;
    margin-bottom: 18px;
}
.card-table { width: 100%; }
.label { font-size: 9px; font-weight: bold; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
.val { font-size: 13px; font-weight: bold; color: #0f172a; margin-top: 2px; }
.val-large { font-size: 18px; font-weight: bold; }
.due-red { color: #dc2626; }
.advance-green { color: #16a34a; }

.ledger-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
    margin-bottom: 20px;
}
.ledger-table th {
    background-color: #0f172a;
    color: #ffffff;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    padding: 8px 10px;
    text-align: left;
}
.ledger-table td {
    padding: 8px 10px;
    border-bottom: 1px solid #e2e8f0;
    font-size: 10px;
}
.ledger-table tr:nth-child(even) td { background-color: #f8fafc; }
.amount-col { text-align: right; font-weight: bold; font-family: monospace; }
.gave-badge { color: #dc2626; font-weight: bold; }
.rec-badge { color: #16a34a; font-weight: bold; }

.footer {
    border-top: 1px solid #cbd5e1;
    padding-top: 10px;
    font-size: 9px;
    color: #64748b;
    display: flex;
    justify-content: space-between;
}
.stamp-box {
    margin-top: 20px;
    text-align: right;
}
.stamp-seal {
    display: inline-block;
    border: 1.5px dashed #FF6A1A;
    padding: 6px 14px;
    border-radius: 6px;
    color: #FF6A1A;
    font-weight: bold;
    font-size: 9px;
    text-transform: uppercase;
}
</style>
</head>
<body>

<table class="header-table" width="100%">
<tr>
    <td valign="top">
        <div class="brand">Reno<span>Pay</span> Khatabook</div>
        <div style="color: #64748b; font-size: 10px; margin-top: 3px;">
            Shop / Merchant: <strong>{{ merchant_name }}</strong> ({{ merchant_vpa }})
        </div>
    </td>
    <td align="right" valign="top">
        <div class="doc-title">Customer Statement</div>
        <div style="color: #64748b; font-size: 9.5px; margin-top: 3px;">Date: {{ generated_at }}</div>
    </td>
</tr>
</table>

<!-- Customer Profile & Balance Snapshot -->
<div class="card-summary">
<table class="card-table">
<tr>
    <td width="35%" valign="top">
        <div class="label">Customer Name</div>
        <div class="val">{{ customer.name }}</div>
        <div style="color: #64748b; font-size: 10px; margin-top: 2px;">Phone: {{ customer.phone }}</div>
        {% if customer.upi_id %}
        <div style="color: #64748b; font-size: 9.5px;">UPI: {{ customer.upi_id }}</div>
        {% endif %}
    </td>
    <td width="30%" valign="top">
        <div class="label">Total Udhar Given</div>
        <div class="val" style="color: #dc2626;">Rs. {{ total_gave_fmt }}</div>
        <div class="label" style="margin-top: 6px;">Total Received (Jama)</div>
        <div class="val" style="color: #16a34a;">Rs. {{ total_received_fmt }}</div>
    </td>
    <td width="35%" align="right" valign="top">
        <div class="label">Current Net Position</div>
        {% if net_balance >= 0 %}
        <div class="val-large due-red">Rs. {{ net_balance_fmt }}</div>
        <div style="font-size: 9px; color: #dc2626; font-weight: bold; margin-top: 2px;">
            DUE (Aapko lene hain)
        </div>
        {% else %}
        <div class="val-large advance-green">Rs. {{ net_balance_fmt }}</div>
        <div style="font-size: 9px; color: #16a34a; font-weight: bold; margin-top: 2px;">
            ADVANCE (Aapko dene hain)
        </div>
        {% endif %}
    </td>
</tr>
</table>
</div>

<!-- Ledger Transactions Table -->
<table class="ledger-table" width="100%">
<thead>
<tr>
    <th width="14%">Date</th>
    <th width="42%">Description / Items Bought</th>
    <th width="14%">Mode</th>
    <th width="15%" style="text-align: right;">Maine Diye (Udhar)</th>
    <th width="15%" style="text-align: right;">Maine Liye (Jama)</th>
</tr>
</thead>
<tbody>
{% if entries %}
{% for e in entries %}
<tr>
    <td>{{ e.entry_date }}</td>
    <td>
        <strong>{{ e.items_description or 'General transaction' }}</strong>
        {% if e.renopay_txn_ref %}
        <br/><span style="color: #64748b; font-size: 8px;">Ref: {{ e.renopay_txn_ref }}</span>
        {% endif %}
    </td>
    <td>{{ e.payment_mode | upper }}</td>
    <td class="amount-col">
        {% if e.entry_type == 'gave' %}
        <span class="gave-badge">+ Rs. {{ e.amount_fmt }}</span>
        {% else %}
        &mdash;
        {% endif %}
    </td>
    <td class="amount-col">
        {% if e.entry_type == 'received' %}
        <span class="rec-badge">- Rs. {{ e.amount_fmt }}</span>
        {% else %}
        &mdash;
        {% endif %}
    </td>
</tr>
{% endfor %}
{% else %}
<tr>
    <td colspan="5" align="center" style="padding: 20px; color: #64748b;">
        No ledger entries recorded yet.
    </td>
</tr>
{% endif %}
</tbody>
</table>

<div class="stamp-box">
    <div class="stamp-seal">Verified Digital Bahi-Khata &bull; RenoPay Verified</div>
</div>

<div class="footer" style="margin-top: 30px;">
    <div>Generated via RenoPay Shopkeeper Mode &bull; Safe &amp; Direct UPI Settlement</div>
    <div>Page 1 of 1</div>
</div>

</body>
</html>"""


MONTHLY_SALES_REPORT_TEMPLATE = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Full Month Business Report &mdash; {{ month_label }}</title>
<style>
@page {
    size: A4 portrait;
    margin: 14mm 16mm;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: Helvetica, Arial, sans-serif;
    color: #1e293b;
    background: #ffffff;
    font-size: 11px;
    line-height: 1.4;
}
.header-table { width: 100%; border-bottom: 2.5px solid #FF6A1A; padding-bottom: 12px; margin-bottom: 16px; }
.brand { font-size: 22px; font-weight: bold; color: #162a45; }
.brand span { color: #FF6A1A; }
.report-title { font-size: 14px; font-weight: bold; text-align: right; color: #0f172a; text-transform: uppercase; }

.kpi-grid { width: 100%; margin-bottom: 16px; }
.kpi-box {
    background-color: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 10px 12px;
}
.kpi-label { font-size: 8.5px; font-weight: bold; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
.kpi-val { font-size: 15px; font-weight: bold; margin-top: 2px; }

.section-head {
    font-size: 11px;
    font-weight: bold;
    color: #0f172a;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-top: 14px;
    margin-bottom: 6px;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 4px;
}

table.data-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 14px;
}
table.data-table th {
    background-color: #0f172a;
    color: #ffffff;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    padding: 7px 9px;
    text-align: left;
}
table.data-table td {
    padding: 6.5px 9px;
    border-bottom: 1px solid #e2e8f0;
    font-size: 9.5px;
}
table.data-table tr:nth-child(even) td { background-color: #f8fafc; }
.text-right { text-align: right; }
.font-mono { font-family: monospace; font-weight: bold; }
</style>
</head>
<body>

<table class="header-table" width="100%">
<tr>
    <td valign="top">
        <div class="brand">Reno<span>Pay</span> Shopkeeper</div>
        <div style="color: #64748b; font-size: 10px; margin-top: 3px;">
            Merchant: <strong>{{ merchant_name }}</strong> ({{ merchant_vpa }})
        </div>
    </td>
    <td align="right" valign="top">
        <div class="report-title">Monthly Business Sales &amp; Hisab</div>
        <div style="color: #FF6A1A; font-weight: bold; font-size: 12px; margin-top: 2px;">{{ month_label }}</div>
        <div style="color: #64748b; font-size: 9px; margin-top: 2px;">Generated on: {{ generated_at }}</div>
    </td>
</tr>
</table>

<!-- Key Business Metrics -->
<table class="kpi-grid" width="100%" cellspacing="8" cellpadding="0">
<tr>
    <td width="25%" class="kpi-box">
        <div class="kpi-label">Total Monthly Sales</div>
        <div class="kpi-val" style="color: #0f172a;">Rs. {{ total_sales_fmt }}</div>
    </td>
    <td width="25%" class="kpi-box">
        <div class="kpi-label">Udhar Given (Out)</div>
        <div class="kpi-val" style="color: #dc2626;">Rs. {{ total_udhar_given_fmt }}</div>
    </td>
    <td width="25%" class="kpi-box">
        <div class="kpi-label">Udhar Recovered (In)</div>
        <div class="kpi-val" style="color: #16a34a;">Rs. {{ total_udhar_recovered_fmt }}</div>
    </td>
    <td width="25%" class="kpi-box">
        <div class="kpi-label">Net Outstanding Dues</div>
        <div class="kpi-val" style="color: #ea580c;">Rs. {{ total_outstanding_fmt }}</div>
    </td>
</tr>
</table>

<!-- Week-wise Breakdown -->
<div class="section-head">1. Week-by-Week Sales Breakdown</div>
<table class="data-table" width="100%">
<thead>
<tr>
    <th width="30%">Period</th>
    <th width="20%" class="text-right">Sales Volume</th>
    <th width="25%" class="text-right">Collections (Jama)</th>
    <th width="25%" class="text-right">Net Cashflow</th>
</tr>
</thead>
<tbody>
{% for w in weekly_breakdown %}
<tr>
    <td><strong>{{ w.week_name }}</strong> ({{ w.dates }})</td>
    <td class="text-right font-mono">Rs. {{ w.sales_fmt }}</td>
    <td class="text-right font-mono" style="color: #16a34a;">Rs. {{ w.collections_fmt }}</td>
    <td class="text-right font-mono" style="color: {{ '#16a34a' if w.net >= 0 else '#dc2626' }};">
        {{ '+' if w.net >= 0 else '' }}Rs. {{ w.net_fmt }}
    </td>
</tr>
{% endfor %}
</tbody>
</table>

<!-- Payment Channels & Collection Methods -->
<div class="section-head">2. Payment Channel Share</div>
<table class="data-table" width="100%">
<thead>
<tr>
    <th width="40%">Payment Method</th>
    <th width="30%" class="text-right">Total Collected</th>
    <th width="30%" class="text-right">% of Total</th>
</tr>
</thead>
<tbody>
<tr>
    <td><strong>RenoPay UPI &amp; Online QR</strong></td>
    <td class="text-right font-mono" style="color: #FF6A1A;">Rs. {{ upi_collected_fmt }}</td>
    <td class="text-right font-mono">{{ upi_pct }}%</td>
</tr>
<tr>
    <td><strong>Cash Counter</strong></td>
    <td class="text-right font-mono">Rs. {{ cash_collected_fmt }}</td>
    <td class="text-right font-mono">{{ cash_pct }}%</td>
</tr>
</tbody>
</table>

<!-- Customer Receivables Summary -->
<div class="section-head">3. Top Outstanding Customer Receivables</div>
<table class="data-table" width="100%">
<thead>
<tr>
    <th width="40%">Customer Name</th>
    <th width="30%">Phone</th>
    <th width="30%" class="text-right">Pending Udhar Amount</th>
</tr>
</thead>
<tbody>
{% if top_debtors %}
{% for d in top_debtors %}
<tr>
    <td><strong>{{ d.name }}</strong></td>
    <td>{{ d.phone }}</td>
    <td class="text-right font-mono" style="color: #dc2626;">Rs. {{ d.balance_fmt }}</td>
</tr>
{% endfor %}
{% else %}
<tr>
    <td colspan="3" align="center" style="color: #64748b; padding: 12px;">No pending customer udhar. All accounts clear!</td>
</tr>
{% endif %}
</tbody>
</table>

<div style="margin-top: 25px; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 8.5px; color: #64748b; text-align: center;">
    Official RenoPay Bahi-Khata Ledger &bull; Certified Automated Record &bull; RenoPay Financial Technologies
</div>

</body>
</html>"""


def _render(tmpl_str: str, ctx: dict) -> str:
    env = Environment(loader=BaseLoader())
    tmpl = env.from_string(tmpl_str)
    return tmpl.render(**ctx)


async def render_khatabook_pdf(template_name: str, data: dict) -> io.BytesIO:
    """Renders HTML template and converts to PDF BytesIO."""
    if template_name == "customer_statement":
        html_str = _render(CUSTOMER_STATEMENT_TEMPLATE, data)
    else:
        html_str = _render(MONTHLY_SALES_REPORT_TEMPLATE, data)

    buf = io.BytesIO()

    if WEASYPRINT_AVAILABLE:
        try:
            pdf_bytes = WeasyprintHTML(string=html_str).write_pdf()
            buf.write(pdf_bytes)
            buf.seek(0)
            return buf
        except Exception:
            pass

    if XHTML2PDF_AVAILABLE:
        try:
            status = pisa.CreatePDF(html_str, dest=buf)
            if not status.err:
                buf.seek(0)
                return buf
        except Exception:
            pass

    raise RuntimeError("PDF rendering engines unavailable on system.")
