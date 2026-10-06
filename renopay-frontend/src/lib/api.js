import { http, setTokens, clearTokens } from "./http";

// ---------- Auth ----------
export const AuthAPI = {
  register: async (payload) => {
    const { data } = await http.post("/auth/register", payload);
    if (data.access_token) {
      setTokens(data);
    }
    return data;
  },

  setPin: async (pin, confirm_pin) => {
    const { data } = await http.patch("/auth/pin", { pin, confirm_pin });
    setTokens(data);
    return data;
  },

  verifyPin: async (pin) => {
    const { data } = await http.post("/auth/verify-pin", { pin });
    return data;
  },

  login: async (phone_number, pin = null, device_fingerprint = null, device_label = null) => {
    const body = { phone_number, device_fingerprint, device_label };
    if (pin) body.pin = pin;
    const { data } = await http.post("/auth/login", body);
    setTokens(data);
    return data;
  },

  logout: async () => {
    const refresh_token = localStorage.getItem("renopay_refresh_token");
    if (refresh_token) {
      try { await http.post("/auth/logout", { refresh_token }); } catch { /* best-effort */ }
    }
    clearTokens();
  },
};

// ---------- Accounts / profile ----------
export const AccountAPI = {
  me: (deviceFingerprint) =>
    http.get("/accounts/me", { params: { device_fingerprint: deviceFingerprint } }).then((r) => r.data),

  trustDevice: (device_fingerprint, device_label) =>
    http.post("/accounts/trust-device", null, { params: { device_fingerprint, device_label } }).then((r) => r.data),

  toggleRoundUp: (enabled) => http.patch("/accounts/round-up", { enabled }).then((r) => r.data),

  updateBudget: (monthly_budget) => http.patch("/accounts/budget", { monthly_budget }).then((r) => r.data),

  updatePreferences: (preferences) => http.patch("/accounts/preferences", preferences).then((r) => r.data),

  uploadProfilePhoto: (formData) =>
    http.post("/accounts/profile-photo", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data),

  deleteProfilePhoto: () =>
    http.delete("/accounts/profile-photo").then((r) => r.data),
};

// ---------- Payments ----------
export const PaymentAPI = {
  resolveVPA: (vpa, pn = null) =>
    http.get(`/payments/resolve/${encodeURIComponent(vpa)}`, { params: pn ? { pn } : {} }).then((r) => r.data),

  sendMoney: (payload) => http.post("/payments/send", payload).then((r) => r.data),
  send: (payload) =>
    http.post("/payments/send", {
      to_vpa: payload.counterparty_vpa || payload.to_vpa,
      amount: payload.amount,
      pin: payload.pin,
      description: payload.note || payload.description,
      category: payload.category || "Other",
    }).then((r) => r.data),

  addMoney: (amount, bank_name) => http.post("/payments/add-money", { amount, bank_name }).then((r) => r.data),

  getTransactions: (limit = 50, offset = 0) =>
    http.get("/payments/transactions", { params: { limit, offset } }).then((r) => r.data),
};

// ---------- Money requests / bill split ----------
export const RequestAPI = {
  create: (to_vpa, amount, note) => http.post("/requests/", { to_vpa, amount, note }).then((r) => r.data),

  createSplit: (total_bill, description, people) =>
    http.post("/requests/split", { total_bill, description, people }).then((r) => r.data),

  inbox: () => http.get("/requests/inbox").then((r) => r.data),

  sent: () => http.get("/requests/sent").then((r) => r.data),

  pay: (requestId, pin) => http.post(`/requests/${requestId}/pay`, { pin }).then((r) => r.data),

  decline: (requestId) => http.post(`/requests/${requestId}/decline`).then((r) => r.data),
};

// ---------- Mandates / subscriptions ----------
export const MandateAPI = {
  list: () => http.get("/mandates/").then((r) => r.data),

  create: (payload) => http.post("/mandates/", payload).then((r) => r.data),

  toggle: (id) => http.post(`/mandates/${id}/toggle`).then((r) => r.data),

  cancel: (id) => http.delete(`/mandates/${id}`).then((r) => r.data),
};

// ---------- Rewards ----------
export const RewardAPI = {
  listScratchCards: () => http.get("/rewards/scratch-cards").then((r) => r.data),
  scratch: (cardId) => http.post(`/rewards/scratch-cards/${cardId}/scratch`).then((r) => r.data),
  summary: () => http.get("/rewards/summary").then((r) => r.data),
  withdraw: (pin) => http.post("/rewards/withdraw", { pin }).then((r) => r.data),
};

// ---------- Savings goals ----------
export const GoalAPI = {
  list: () => http.get("/goals/").then((r) => r.data),

  create: (name, icon, target) => http.post("/goals/", { name, icon, target }).then((r) => r.data),

  addSavings: (goalId, amount, pin) => http.post(`/goals/${goalId}/add`, { amount, pin }).then((r) => r.data),

  withdraw: (goalId, pin, amount = null) => http.post(`/goals/${goalId}/withdraw`, { pin, amount }).then((r) => r.data),

  setAutoSave: (goalId, enabled, daily_amount) =>
    http.patch(`/goals/${goalId}/auto-save`, { enabled, daily_amount }).then((r) => r.data),
};


// ---------- Shared vaults ----------
export const VaultAPI = {
  list: () => http.get("/vaults/").then((r) => r.data),

  create: (name, icon, target, member_phone_numbers = [], member_vpas = []) =>
    http.post("/vaults/", { name, icon, target, member_phone_numbers, member_vpas }).then((r) => r.data),

  addMember: (vaultId, identifier) =>
    http.post(`/vaults/${vaultId}/members`, { identifier }).then((r) => r.data),

  contribute: (vaultId, amount, pin) =>
    http.post(`/vaults/${vaultId}/contribute`, { amount, pin }).then((r) => r.data),

  withdrawMyContribution: (vaultId, pin) =>
    http.post(`/vaults/${vaultId}/withdraw-my-contribution`, { pin }).then((r) => r.data),

  requestWithdrawal: (vaultId, amount, pin) =>
    http.post(`/vaults/${vaultId}/request-withdrawal`, { amount, pin }).then((r) => r.data),

  approveWithdrawal: (vaultId, pin) =>
    http.post(`/vaults/${vaultId}/approve-withdrawal`, { pin }).then((r) => r.data),

  rejectWithdrawal: (vaultId) =>
    http.post(`/vaults/${vaultId}/reject-withdrawal`).then((r) => r.data),
};

// ---------- UPI Lite ----------
export const LiteAPI = {
  topUp: (amount, pin) => http.post("/lite/top-up", { amount, pin }).then((r) => r.data),
  // Spending Lite balance goes through PaymentAPI.sendMoney with use_upi_lite: true
};

// ---------- Gift Cards ----------
export const GiftCardAPI = {
  create: (payload) => http.post("/gift-cards/create", payload).then((r) => r.data),
  claim: (code) => http.post("/gift-cards/claim", { code }).then((r) => r.data),
  myCards: () => http.get("/gift-cards/my-cards").then((r) => r.data),
  downloadPdf: async (cardId) => {
    const r = await http.get(`/gift-cards/${cardId}/pdf`, { responseType: "blob" });
    return r.data;
  },
};

// ---------- Analytics ----------
export const AnalyticsAPI = {
  budgetPrediction: () => http.get("/analytics/budget-prediction").then((r) => r.data),

  expenses: (period = "month", startDate = null, endDate = null) => {
    const params = { period };
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    return http.get("/analytics/expenses", { params }).then((r) => r.data);
  },

  expensePdf: async (period = "month", startDate = null, endDate = null) => {
    const params = { period };
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    const r = await http.get("/analytics/expenses/pdf", { params, responseType: "blob" });
    return r.data; // Blob
  },

  downloadReport: async ({ type, from, to, txn_ref }) => {
    const params = { type };
    if (from) params.from = from;
    if (to) params.to = to;
    if (txn_ref) params.txn_ref = txn_ref;
    const r = await http.get("/analytics/report", { params, responseType: "blob" });
    return r.data; // Blob
  },
};

// ---------- Voice UPI ----------
export const VoiceAPI = {
  parse: (payload) => http.post("/payments/voice-parse", payload).then((r) => r.data),
};

// Add voiceParse to PaymentAPI for convenience
PaymentAPI.voiceParse = (payload) => http.post("/payments/voice-parse", payload).then((r) => r.data);

// ---------- Digital Gold ----------
export const GoldAPI = {
  getSummary: () => http.get("/gold/summary").then((r) => r.data),
  summary: () => http.get("/gold/summary").then((r) => r.data),
  toggleRoundUp: () => http.patch("/gold/toggle-roundup").then((r) => r.data),
  withdraw: (pin, amount = null) => http.post("/gold/withdraw", { pin, amount }).then((r) => r.data),
};

// ---------- Accounting ----------
export const AccountingAPI = {
  getChartOfAccounts: () => http.get("/accounting/chart-of-accounts").then((r) => r.data),
  getJournal: (from, to) => http.get("/accounting/journal", { params: { from, to } }).then((r) => r.data),
  getLedger: (chart_account_id, from, to) => http.get(`/accounting/ledger/${chart_account_id}`, { params: { from, to } }).then((r) => r.data),
  getPayeeLedger: (payee_vpa, from, to) => http.get(`/accounting/ledger/payee/${payee_vpa}`, { params: { from, to } }).then((r) => r.data),
  getTrialBalance: (as_of) => http.get("/accounting/trial-balance", { params: { as_of } }).then((r) => r.data),
  getPnL: (from, to) => http.get("/accounting/pnl", { params: { from, to } }).then((r) => r.data),
  getBalanceSheet: (as_of) => http.get("/accounting/balance-sheet", { params: { as_of } }).then((r) => r.data),
  getCashFlow: (from, to) => http.get("/accounting/cash-flow", { params: { from, to } }).then((r) => r.data),
  toggleDevMode: (enabled) => http.patch("/accounting/dev-mode", { enabled }).then((r) => r.data),
  getGstReport: (from, to) => http.get("/accounting/reports/gst", { params: { from, to } }).then((r) => r.data),
  generatePayroll: (employees) => http.post("/accounting/payroll/generate", { employees }).then((r) => r.data),
  getInvoices: () => http.get("/accounting/invoices").then((r) => r.data),
  createInvoice: (customer_name, amount) => http.post("/accounting/invoices", { customer_name, amount }).then((r) => r.data),
  payInvoice: (id) => http.post(`/accounting/invoices/${id}/pay`).then((r) => r.data),
};

// ---------- Savings Goals (extra) ----------
GoalAPI.setAutoSave = (goalId, enabled, daily_amount) =>
  http.patch(`/goals/${goalId}/auto-save`, { enabled, daily_amount }).then((r) => r.data);

// ---------- Multilingual AI Assistant (RenoAI) ----------
export const AIAPI = {
  query: (query_text, screen_context = null, language = null, session_id = null) =>
    http.post("/ai/query", { query_text, screen_context, language, session_id }).then((r) => r.data),

  getSessions: () => http.get("/ai/sessions").then((r) => r.data),

  getMessages: (session_id) => http.get(`/ai/sessions/${session_id}/messages`).then((r) => r.data),

  deleteSession: (session_id) => http.delete(`/ai/sessions/${session_id}`).then((r) => r.data),
};

// ---------- Travel & Transit ----------
export const TravelAPI = {
  book: (payload) => http.post("/travel/book", payload).then((r) => r.data),
  getBookings: (limit = 30) => http.get("/travel/bookings", { params: { limit } }).then((r) => r.data),
  getTicketPdf: async (booking_id) => {
    const r = await http.get(`/travel/ticket/${booking_id}/pdf`, { responseType: "blob" });
    return r.data;
  },
};

// ---------- Unified Financial Services (Bills, Loans, Investments) ----------
export const FinancialAPI = {
  // Bills & Recharges
  payBill: (payload) => http.post("/financial/bills/pay", payload).then((r) => r.data),

  // Loans
  applyLoan: (payload) => http.post("/financial/loans/apply", payload).then((r) => r.data),
  repayLoan: (payload) => http.post("/financial/loans/repay", payload).then((r) => r.data),
  getLoans: () => http.get("/financial/loans").then((r) => r.data),

  // Mutual Funds & Daily RD
  invest: (payload) => http.post("/financial/investments/invest", payload).then((r) => r.data),
  getInvestments: () => http.get("/financial/investments").then((r) => r.data),

  // Transaction Receipt PDF
  getReceiptPdf: async (txnRef) => {
    const r = await http.get(`/financial/receipt/${encodeURIComponent(txnRef)}/pdf`, { responseType: "blob" });
    return r.data;
  },
};

// ---------- Merchant Voice Box (Soundbox) ----------
export const VoiceBoxAPI = {
  getStatus: () => http.get("/voicebox/status").then((r) => r.data),
  activate: (language = "hi", pin = null) => http.post("/voicebox/activate", { language, pin }).then((r) => r.data),
  changeLanguage: (language, pin = null) => http.post("/voicebox/change-language", { language, pin }).then((r) => r.data),
  renew: (pin = null) => http.post("/voicebox/renew", { pin }).then((r) => r.data),
  toggleSettings: (settings) => http.post("/voicebox/toggle-settings", settings).then((r) => r.data),
  pollAnnouncements: (since_txn_ref = null) =>
    http.get("/voicebox/announcements/poll", { params: since_txn_ref ? { since_txn_ref } : {} }).then((r) => r.data),
  sampleAnnouncement: (sender_name = "rishabh", amount = 100, language = null) =>
    http.post("/voicebox/sample-announcement", { sender_name, amount, language }).then((r) => r.data),
};

// ---------- Digital Khatabook ----------
export const KhatabookAPI = {
  getSummary: () => http.get("/khatabook/summary").then((r) => r.data),
  getCustomers: (search = "", filter_type = null) =>
    http.get("/khatabook/customers", { params: { search, filter_type } }).then((r) => r.data),
  createCustomer: (customer) => http.post("/khatabook/customers", customer).then((r) => r.data),
  getCustomerDetails: (customerId) => http.get(`/khatabook/customers/${customerId}`).then((r) => r.data),
  addEntry: (customerId, entry) => http.post(`/khatabook/customers/${customerId}/entries`, entry).then((r) => r.data),
  requestPayment: (customerId, amount = null, note = null) =>
    http.post(`/khatabook/customers/${customerId}/request-pay`, { amount, note }).then((r) => r.data),
  parseVoiceEntry: (transcript, auto_save = false) =>
    http.post("/khatabook/voice-parse", { transcript, auto_save }).then((r) => r.data),
  getCustomerPdf: async (customerId) => {
    const r = await http.get(`/khatabook/customers/${customerId}/pdf`, { responseType: "blob" });
    return r.data;
  },
  getMonthlySalesPdf: async (month = null, year = null) => {
    const r = await http.get("/khatabook/reports/monthly-sales-pdf", { params: { month, year }, responseType: "blob" });
    return r.data;
  },
};


