import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AccountingScreen } from '../screens/AccountingScreen';
import { AccountingAPI, AnalyticsAPI } from '../lib/api';

vi.mock('../lib/api', () => ({
  AccountingAPI: {
    getJournal: vi.fn().mockResolvedValue([]),
    getChartOfAccounts: vi.fn().mockResolvedValue([]),
    getLedger: vi.fn().mockResolvedValue(null),
    getPayeeLedger: vi.fn().mockResolvedValue(null),
    getTrialBalance: vi.fn(),
    getPnL: vi.fn().mockResolvedValue(null),
    getBalanceSheet: vi.fn().mockResolvedValue(null),
    getCashFlow: vi.fn().mockResolvedValue(null),
    getGstReport: vi.fn().mockResolvedValue(null),
    getInvoices: vi.fn().mockResolvedValue([]),
    toggleDevMode: vi.fn().mockResolvedValue({}),
  },
  AnalyticsAPI: {
    downloadReport: vi.fn(),
  },
  VoiceBoxAPI: {
    getStatus: vi.fn().mockResolvedValue({ is_active: false }),
  },
  KhatabookAPI: {
    getSummary: vi.fn().mockResolvedValue({}),
    getCustomers: vi.fn().mockResolvedValue({ customers: [] }),
  },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: 'merchant_1',
      full_name: 'Merchant User',
    },
  }),
}));

vi.mock('../lib/download', () => ({
  downloadOrSharePdf: vi.fn().mockResolvedValue(true),
}));

describe('AccountingScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders default shopkeeper mode and switches to Enterprise Accounting mode', async () => {
    render(<AccountingScreen onBack={() => {}} />);

    expect(screen.getAllByText(/Shopkeeper Mode/i)[0]).toBeInTheDocument();

    // Click Accounting (Enterprise) mode button
    const acctModeBtn = screen.getByText(/Accounting \(Enterprise\)/i);
    fireEvent.click(acctModeBtn);

    await waitFor(() => {
      expect(screen.getByText('Developer Mode')).toBeInTheDocument();
      expect(screen.getByText('Unlock Accounting Engine')).toBeInTheDocument();
    });
  });

  it('enables developer mode and renders balanced trial balance', async () => {
    AccountingAPI.getTrialBalance.mockResolvedValueOnce({
      balanced: true,
      total_debit: '₹50,000.00',
      total_credit: '₹50,000.00',
      rows: [
        { code: '1010', name: 'Cash at Bank', debit: '₹50,000.00', credit: '₹0.00' },
        { code: '3010', name: "Owner's Equity", debit: '₹0.00', credit: '₹50,000.00' },
      ],
    });

    render(<AccountingScreen onBack={() => {}} />);

    // Switch to accounting mode
    fireEvent.click(screen.getByText(/Accounting \(Enterprise\)/i));

    // Toggle Developer Mode
    const devToggle = screen.getByRole('button', { name: '' });
    fireEvent.click(devToggle);

    await waitFor(() => {
      expect(screen.getByText('Trial Balance')).toBeInTheDocument();
    });

    // Switch to Trial Balance tab
    fireEvent.click(screen.getByText('Trial Balance'));

    await waitFor(() => {
      expect(AccountingAPI.getTrialBalance).toHaveBeenCalled();
      expect(screen.getByText('Cash at Bank')).toBeInTheDocument();
      expect(screen.getByText("Owner's Equity")).toBeInTheDocument();
      expect(screen.queryByText('⚠️ BALANCE MISMATCH')).not.toBeInTheDocument();
    });
  });

  it('triggers full accounting pack PDF export', async () => {
    AnalyticsAPI.downloadReport.mockResolvedValueOnce(new Blob(['pdf content'], { type: 'application/pdf' }));

    render(<AccountingScreen onBack={() => {}} />);

    // Switch to accounting mode
    fireEvent.click(screen.getByText(/Accounting \(Enterprise\)/i));

    // Toggle Dev Mode to expose accounting pack
    const devToggle = screen.getByRole('button', { name: '' });
    fireEvent.click(devToggle);

    await waitFor(() => {
      expect(screen.getByText('Full Accounting Report')).toBeInTheDocument();
    });

    // Open pack accordion
    fireEvent.click(screen.getByText('Full Accounting Report'));

    // Click Download Pack button
    const downloadBtn = screen.getByText('Download Pack');
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      expect(AnalyticsAPI.downloadReport).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'full_accounting_pack' })
      );
    });
  });
});
