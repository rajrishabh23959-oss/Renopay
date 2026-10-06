"""
Curated knowledge base of RenoPay features and documentation.
Used by RAG retrieval engine to provide accurate, hallucination-free assistance.
"""

RENOPAY_DOCS = [
    {
        "id": "split_bill",
        "title": "Split Bill (Expense Splitting with Friends & Groups)",
        "screen": "split",
        "keywords": ["split", "bill", "share", "friends", "group", "divide", "expense", "settle", "contribute"],
        "content": (
            "RenoPay Split Bill feature allows users to split restaurant, trip, or shared expenses:\n"
            "1. Navigate to 'Split Bill' from the Home screen quick actions.\n"
            "2. Enter the Total Bill amount and a description (e.g. 'Goa Trip Dinner').\n"
            "3. Add participants by their Phone Number or RenoPay UPI ID (VPA).\n"
            "4. RenoPay automatically calculates equal shares or allows custom amounts per person.\n"
            "5. Tap 'Send Split Requests' to dispatch instant payment requests to all participants.\n"
            "6. You can track who has paid and who is pending directly from the Requests screen."
        ),
    },
    {
        "id": "shared_vaults",
        "title": "Shared Vaults (Joint Savings & Multi-Sig Withdrawals)",
        "screen": "vaults",
        "keywords": ["vault", "vaults", "shared", "pool", "joint", "savings", "multi-sig", "group target", "emergency"],
        "content": (
            "RenoPay Shared Vaults allow groups, roommates, or couples to save money together towards a shared target:\n"
            "1. Navigate to 'Shared Vaults' from the Home screen or menu.\n"
            "2. Tap 'Create New Vault', give it a title (e.g., 'Apartment Rent & Bills' or 'Japan Trip 2025'), and set a target amount.\n"
            "3. Add members using their phone numbers or VPAs.\n"
            "4. Any member can contribute funds to the vault at any time using their UPI PIN.\n"
            "5. Withdrawals require Multi-Signature Approval: when someone requests a withdrawal, members receive a prompt to approve or decline.\n"
            "6. Emergency individual withdrawals of own contributions are supported if needed."
        ),
    },
    {
        "id": "sentinai_security",
        "title": "SentinAI AI Fraud Detection & Device Security",
        "screen": "sentinai",
        "keywords": ["sentinai", "fraud", "security", "device", "trusted", "pin", "protection", "risk", "privacy code", "geo-velocity"],
        "content": (
            "SentinAI is RenoPay's proprietary real-time AI security & fraud detection engine:\n"
            "1. Risk Scoring: Every payment is evaluated in milliseconds based on recipient history, transaction size, and velocity.\n"
            "2. Geo-Velocity Check: If a transaction occurs from a distant city/device faster than physically travelable, SentinAI flags it.\n"
            "3. Trusted Devices: In Profile, tap 'Trust This Device' to whitelist your current browser/phone. Untrusted devices require additional verification.\n"
            "4. High-Value Privacy Codes: For transactions exceeding ₹2,000, SentinAI may prompt for a secondary Privacy Code or additional verification.\n"
            "5. Failed PIN Lockout: 5 consecutive incorrect PIN entries locks the account for 15 minutes to prevent brute-force attacks."
        ),
    },
    {
        "id": "upi_lite",
        "title": "UPI Lite (Pinless Instant Small Payments)",
        "screen": "upilite",
        "keywords": ["upi lite", "lite", "small payments", "pinless", "wallet", "speed", "quick pay", "offline"],
        "content": (
            "RenoPay UPI Lite provides lightning-fast 1-click payments without needing a UPI PIN:\n"
            "1. Maximum balance allowed in UPI Lite is ₹2,000.\n"
            "2. Maximum single transaction limit is ₹500.\n"
            "3. Go to 'UPI Lite' from the Home screen and top up from your main RenoPay account balance using your UPI PIN.\n"
            "4. While sending money or scanning a QR code, toggle 'Use UPI Lite' to execute payments instantly without entering a PIN.\n"
            "5. Transactions have near-zero bank server failure rates because they process on-device."
        ),
    },
    {
        "id": "digital_gold",
        "title": "Digital Gold & Auto Round-Up Savings",
        "screen": "gold",
        "keywords": ["gold", "digital gold", "round up", "roundup", "24k", "savings", "invest", "withdraw gold"],
        "content": (
            "RenoPay Digital Gold allows 24 Karat 99.9% purity digital gold accumulation:\n"
            "1. Round-Up Feature: In Profile screen, toggle 'Round-Up to Digital Gold'. When enabled, transactions are rounded up to the nearest ₹10 or ₹50, and the spare change is automatically saved as Digital Gold!\n"
            "2. View your total gold balance in INR and grams on the Digital Gold screen.\n"
            "3. Instant Cash Withdrawal: You can sell/withdraw your gold back into your main account balance anytime with your UPI PIN directly from Profile or Gold screen."
        ),
    },
    {
        "id": "cash_drawer",
        "title": "Smart Cash Drawer & Offline Currency Denominations",
        "screen": "cash",
        "keywords": ["cash", "notes", "denominations", "500", "200", "100", "50", "currency", "drawer", "offline cash"],
        "content": (
            "RenoPay Smart Cash Denominations tracks physical cash on hand:\n"
            "1. Shows exact breakdown of currency notes: ₹500, ₹200, ₹100, ₹50, ₹20, ₹10.\n"
            "2. Automatically updates denominations when cash is withdrawn or deposited.\n"
            "3. Perfect for merchants, small businesses, and individuals managing both digital UPI and cash transactions."
        ),
    },
    {
        "id": "accounting_ledger",
        "title": "Double-Entry Accounting, Journals, Trial Balance & GST Reports",
        "screen": "accounting",
        "keywords": ["accounting", "ledger", "double entry", "journal", "trial balance", "gst", "gstr", "payroll", "invoice", "debit", "credit"],
        "content": (
            "RenoPay includes an enterprise-grade Double-Entry Accounting Engine:\n"
            "1. Chart of Accounts: Standard assets, liabilities, equity, revenues, and expenses accounts (e.g., Bank, Cash Drawer, UPI Clearing, Accounts Receivable, Sales, Operating Expenses).\n"
            "2. Journal Entries: Every payment automatically logs balanced Debit and Credit lines with audit timestamps.\n"
            "3. Trial Balance: Generates real-time balanced debit/credit summaries as of any selected date.\n"
            "4. GST Reports: Generates automated GSTR-1 and GSTR-3B tax compliance summaries with CGST, SGST, and IGST breakdowns.\n"
            "5. Payroll Generation: Run monthly salary calculations with basic pay, HRA, and tax deductions with one click.\n"
            "6. Invoicing: Create branded customer invoices and track their payment settlement status."
        ),
    },
    {
        "id": "qr_and_pay",
        "title": "Scan & Pay, Personal QR Card & Money Transfers",
        "screen": "pay",
        "keywords": ["pay", "scan", "qr", "send money", "vpa", "upi id", "download qr", "transfer"],
        "content": (
            "RenoPay provides effortless money transfers via QR codes and UPI IDs:\n"
            "1. Pay Screen: Enter any recipient's UPI ID (e.g. friend@renopay or user@okhdfcbank), amount, and note, then confirm with your UPI PIN.\n"
            "2. Scan Screen: Point your camera at any BharatQR or UPI QR code to automatically parse recipient and amount.\n"
            "3. Receive Money QR: Under Profile screen or 'Receive' button, view your unique RenoPay QR code. Tap 'Download QR Code' to generate a high-res branded sharing card to save or print."
        ),
    },
    {
        "id": "voice_upi",
        "title": "Voice UPI (Spoken Payment Commands)",
        "screen": "voice",
        "keywords": ["voice", "speak", "mic", "talk", "voice upi", "voice pay", "speech", "command"],
        "content": (
            "RenoPay supports Voice-driven UPI payments:\n"
            "1. Tap the Voice UPI icon from the Home screen.\n"
            "2. Speak naturally, e.g., 'Pay 500 rupees to rishabh for lunch'.\n"
            "3. The browser extracts the recipient name, amount, and note.\n"
            "4. RenoPay resolves the contact VPA and pre-fills the payment confirmation screen for your review."
        ),
    },
    {
        "id": "savings_and_mandates",
        "title": "Savings Goals & Recurring Mandates (Autopay)",
        "screen": "savings",
        "keywords": ["goals", "mandates", "autopay", "recurring", "auto save", "target", "subscriptions"],
        "content": (
            "Automate your savings and regular bills with RenoPay:\n"
            "1. Savings Goals: Create personal savings goals with custom target amounts and deadlines. Enable 'Daily Auto-Save' to automatically stash ₹50 or ₹100 daily towards your goal.\n"
            "2. Mandates & Subscriptions: Manage recurring payments (Netflix, Rent, SIPs, Electricity) with scheduled auto-debit and pause/resume control."
        ),
    },
    {
        "id": "rewards_scratch_cards",
        "title": "Rewards, Cashbacks & Scratch Cards",
        "screen": "rewards",
        "keywords": ["rewards", "scratch", "card", "cashback", "coins", "bonus", "win"],
        "content": (
            "Earn instant cashback and rewards on RenoPay:\n"
            "1. Every eligible UPI payment grants a digital Scratch Card.\n"
            "2. Visit 'Rewards' screen, swipe to scratch and reveal real cash or digital gold prizes.\n"
            "3. Tap 'Withdraw to Bank' to instantly transfer accumulated reward money into your primary account."
        ),
    },
    {
        "id": "travel_booking",
        "title": "Travel & Transit: How to Book Train, Flight, Bus & Hotel Tickets",
        "screen": "travel",
        "keywords": [
            "travel", "ticket", "train", "flight", "bus", "hotel", "book", "irctc",
            "pnr", "boarding pass", "tatkal", "berth", "seat", "booking", "yatra", "safar",
            "tickets", "airline", "indigo", "air india", "redbus", "railway", "station"
        ],
        "content": (
            "How to book travel tickets and hotels on RenoPay:\n"
            "1. Open 'Travel' from the RenoPay Home screen or navigation bar.\n"
            "2. Select your category: ✈️ Flights, 🚆 Trains, 🚌 Buses, or 🏨 Hotels.\n"
            "3. Enter your Origin & Destination city (or City for hotels), Travel Date, and Class (e.g., 3rd AC / Economy / AC Sleeper / Deluxe Room).\n"
            "4. RenoPay shows real-time schedules, operators (IndiGo, Air India, IRCTC Rajdhani, RedBus, etc.), and upfront prices.\n"
            "5. Click 'Book Now', then enter Passenger Name, Age, Gender, and Berth/Seat preference.\n"
            "6. Click 'Proceed to Pay': choose between ⚡ Normal Pay (direct 6-digit UPI PIN) or 🚀 Advance Pay (interactive tactile note slider + PIN).\n"
            "7. Once confirmed, payment is debited from your RenoPay account, and your official PNR or Ticket Reference is generated immediately.\n"
            "8. Tap 'View Ticket (PDF)' or 'Download Ticket (PDF)' to instantly save your official boarding pass and journey itinerary.\n"
            "9. You can view, download, or manage all your past and upcoming bookings anytime under the 'My Bookings' tab at the top of the Travel screen."
        ),
    },
    {
        "id": "instant_loans",
        "title": "Instant Loans: How to Apply and Repay EMIs",
        "screen": "loans",
        "keywords": [
            "loan", "loans", "emi", "borrow", "credit", "personal loan", "gold loan",
            "mutual fund loan", "lamf", "disbursal", "repay", "interest", "tenure", "karz", "udhar"
        ],
        "content": (
            "How to get an instant loan and repay EMIs on RenoPay:\n"
            "1. Open 'Loans' from the RenoPay Home screen.\n"
            "2. Choose your Loan Category:\n"
            "   - Instant Personal Loan: Up to ₹5,00,000 at 10.5% p.a.\n"
            "   - Loan Against Mutual Funds (LAMF): Up to ₹10,00,000 at 9.25% p.a. without selling your mutual fund units.\n"
            "   - Instant Gold Loan: Up to ₹15,00,000 at 8.75% p.a. against your digital gold reserve.\n"
            "3. Use the interactive EMI Calculator to choose your amount and flexible tenure (6 to 36 months).\n"
            "4. Fill your Employment status, Monthly income, and PAN Number. Zero physical documentation required.\n"
            "5. Tap 'Apply for Instant Loan'. Approval takes seconds, and funds are disbursed instantly directly into your RenoPay wallet balance with an official transaction record (RENO-TXN-LN...).\n"
            "6. To Repay an EMI: Under 'Active Loans' on the Loans screen, tap 'Pay EMI Now', enter your 6-digit UPI PIN, and the EMI is deducted from your balance. Download your official tax-compliant PDF Repayment Receipt."
        ),
    },
    {
        "id": "recharge_and_bills",
        "title": "Recharges & Bill Payments (Mobile, Electricity BBPS & Tuition Fees)",
        "screen": "recharge",
        "keywords": [
            "recharge", "bill", "bills", "mobile", "jio", "airtel", "vi", "bsnl",
            "electricity", "bijli", "tuition", "fee", "fees", "fastag", "dth", "broadband", "bbps"
        ],
        "content": (
            "How to pay bills and recharge on RenoPay:\n"
            "1. Open 'Recharge & Bills' from the RenoPay Home screen.\n"
            "2. Available Services:\n"
            "   - Mobile Recharge: Enter mobile number, choose operator (Jio, Airtel, Vi, BSNL), select popular/unlimited 5G/annual plan, and pay.\n"
            "   - Tuition Fees: Manage teachers/tutors by adding their UPI ID, student name, and fee. Never miss a due date with 1-click tuition settlement.\n"
            "   - Electricity & Utility Bills: Powered by BBPS. Enter Consumer Number and Board (e.g. BSES, Tata Power, BESCOM) to fetch and pay current bill.\n"
            "   - Fastag & DTH: Instant toll recharge and TV subscription renewals.\n"
            "3. Payment: Select ⚡ Normal Pay (instant UPI PIN) or 🚀 Advance Pay (note slider), authenticate with your 6-digit PIN.\n"
            "4. Money is deducted from your RenoPay account, and an official PDF receipt is immediately available for download."
        ),
    },
    {
        "id": "mutual_funds_wealth",
        "title": "Mutual Funds, Daily ₹10 Micro-SIP & Daily RD (8.1% p.a.)",
        "screen": "mutualfunds",
        "keywords": [
            "mutual fund", "mutual funds", "sip", "micro sip", "rd", "recurring deposit",
            "investment", "invest", "wealth", "portfolio", "returns", "cagr", "nifty", "interest"
        ],
        "content": (
            "How to invest in Mutual Funds & Savings on RenoPay:\n"
            "1. Open 'Mutual Funds' from the RenoPay Home screen.\n"
            "2. Investment Options:\n"
            "   - Monthly SIP: Invest in top 5-star rated equity, hybrid, and index funds (Parag Parikh, Mirae Asset, Quant, etc.) starting from ₹500/month.\n"
            "   - Daily ₹10 Micro-SIP: Build massive wealth effortlessly by auto-investing just ₹10 every day.\n"
            "   - Daily Recurring Deposit (RD): Earn a guaranteed high return of 8.1% p.a. with daily interest accrual and flexible withdrawal.\n"
            "3. Tap 'Invest Now', verify the fund details, and confirm payment using your UPI PIN.\n"
            "4. Amount is debited from your RenoPay account, units are credited to your in-app portfolio, and an official PDF Investment Certificate is generated."
        ),
    },
    {
        "id": "payment_modes_normal_advance",
        "title": "Payment Modes: Normal Pay vs Advance Pay",
        "screen": "pay",
        "keywords": [
            "normal pay", "advance pay", "note slider", "payment mode", "mode", "notes",
            "coins", "slide", "keypad", "pin", "tactile", "haptic", "how to pay"
        ],
        "content": (
            "RenoPay offers two unique payment experiences:\n"
            "1. ⚡ Normal Pay (Standard & Fast):\n"
            "   - Enter the amount directly via numeric keypad (or use prefilled amount for tickets/bills).\n"
            "   - Enter your 6-digit UPI PIN.\n"
            "   - Payment is authenticated and processed within 2 seconds. Ideal for quick everyday merchant checkouts.\n"
            "2. 🚀 Advance Pay (Signature RenoPay Multi-Sensory Note Slider):\n"
            "   - Experience digital money like real physical currency!\n"
            "   - Interactive draggable notes (₹500, ₹200, ₹100, ₹50, ₹20, ₹10) and clickable coins (₹5, ₹2, ₹1).\n"
            "   - Slide notes into the recipient drop tray with authentic bill-sliding sound effects, floating counter, and haptic vibrations.\n"
            "   - Eliminates typing mistakes and accidental zeros.\n"
            "   - Enter your 6-digit UPI PIN to finalize payment.\n"
            "3. Direct Request Pay:\n"
            "   - When paying a bill, preset request, or booking with fixed price, you can immediately confirm with your 6-digit UPI PIN without retyping."
        ),
    },
]

