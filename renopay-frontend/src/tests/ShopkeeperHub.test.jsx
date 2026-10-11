import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShopkeeperHub } from '../components/ShopkeeperHub';
import { KhatabookAPI, VoiceBoxAPI } from '../lib/api';

vi.mock('../lib/api', () => ({
  VoiceBoxAPI: {
    getStatus: vi.fn(),
    activate: vi.fn(),
    changeLanguage: vi.fn(),
    testTone: vi.fn(),
  },
  KhatabookAPI: {
    getSummary: vi.fn(),
    getCustomers: vi.fn(),
    getCustomerDetails: vi.fn(),
    createCustomer: vi.fn(),
    addEntry: vi.fn(),
    requestPayment: vi.fn(),
  },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: 'merchant_1',
      full_name: 'Ramesh Kirana Store',
    },
  }),
}));

vi.mock('../hooks/useRenoSocket', () => ({
  useRenoSocket: vi.fn(),
}));

vi.mock('../hooks/useVoiceBoxAnnouncer', () => ({
  useVoiceBoxAnnouncer: vi.fn(),
  speakAnnouncement: vi.fn(),
  playSoundboxChime: vi.fn(),
}));

describe('ShopkeeperHub', () => {
  const mockSummary = {
    monthly_sales: 45000,
    monthly_collections: 32000,
    total_you_will_get: 13000,
    total_you_will_give: 2000,
    month_label: 'October 2026',
  };

  const mockCustomers = [
    {
      id: 'cust_1',
      name: 'Suresh Kumar',
      phone: '9876543210',
      net_balance: 1500,
      net_balance_paise: 150000,
      latest_entry_date: '2026-10-10',
    },
    {
      id: 'cust_2',
      name: 'Mohan Lal',
      phone: '9123456780',
      net_balance: -500,
      net_balance_paise: -50000,
      latest_entry_date: '2026-10-09',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    VoiceBoxAPI.getStatus.mockResolvedValue({
      is_active: true,
      language: 'hi',
      plan_name: 'PRO',
    });
    KhatabookAPI.getSummary.mockResolvedValue(mockSummary);
    KhatabookAPI.getCustomers.mockResolvedValue({ customers: mockCustomers });
  });

  it('renders shopkeeper dashboard summary metrics and customer ledger', async () => {
    render(<ShopkeeperHub />);

    await waitFor(() => {
      expect(screen.getByText(/Shopkeeper Mode/i)).toBeInTheDocument();
      expect(screen.getByText('Suresh Kumar')).toBeInTheDocument();
      expect(screen.getByText('Mohan Lal')).toBeInTheDocument();
    });
  });

  it('switches tabs to filter due vs advance customers', async () => {
    render(<ShopkeeperHub />);

    await waitFor(() => {
      expect(screen.getByText('Suresh Kumar')).toBeInTheDocument();
    });

    // Switch to Udhar Due tab
    const dueTab = screen.getByText(/Udhar Due/i);
    fireEvent.click(dueTab);

    await waitFor(() => {
      expect(KhatabookAPI.getCustomers).toHaveBeenCalledWith('', 'due');
    });

    // Switch to Advance tab
    const advanceTab = screen.getByRole('button', { name: /Advance/i });
    fireEvent.click(advanceTab);

    await waitFor(() => {
      expect(KhatabookAPI.getCustomers).toHaveBeenCalledWith('', 'advance');
    });
  });

  it('loads customer itemized ledger details when a customer row is tapped', async () => {
    KhatabookAPI.getCustomerDetails.mockResolvedValueOnce({
      customer: {
        id: 'cust_1',
        name: 'Suresh Kumar',
        phone: '9876543210',
        net_balance: 1500,
      },
      entries: [
        {
          id: 'ent_1',
          entry_type: 'gave',
          amount: 1500,
          items_description: '5kg Basmati Rice',
          entry_date: '2026-10-10',
        },
      ],
      total_gave: 1500,
      total_received: 0,
    });

    render(<ShopkeeperHub />);

    await waitFor(() => {
      expect(screen.getByText('Suresh Kumar')).toBeInTheDocument();
    });

    // Tap on Suresh Kumar customer card
    fireEvent.click(screen.getByText('Suresh Kumar'));

    await waitFor(() => {
      expect(KhatabookAPI.getCustomerDetails).toHaveBeenCalledWith('cust_1');
      expect(screen.getByText('5kg Basmati Rice')).toBeInTheDocument();
    });
  });
});
