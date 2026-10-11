import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VaultScreen } from '../screens/VaultScreen';
import { VaultAPI } from '../lib/api';

vi.mock('../lib/api', () => ({
  VaultAPI: {
    list: vi.fn(),
    create: vi.fn(),
    contribute: vi.fn(),
    addMember: vi.fn(),
    withdrawMyContribution: vi.fn(),
    requestWithdrawal: vi.fn(),
    approveWithdrawal: vi.fn(),
  },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: 'user_1',
      full_name: 'Test Vault Owner',
    },
    refreshProfile: vi.fn(),
  }),
}));

vi.mock('../hooks/useRenoSocket', () => ({
  useRenoSocket: vi.fn(),
}));

vi.mock('../components/PINPad', () => ({
  PINPad: ({ onComplete }) => (
    <div data-testid="pin-pad">
      <button onClick={() => onComplete('123456')}>Submit Vault PIN</button>
    </div>
  ),
}));

describe('VaultScreen', () => {
  const mockVaults = [
    {
      id: 'vault_1',
      name: 'Goa Trip 2026',
      icon: '🏖️',
      balance: 15000,
      target: 50000,
      status: 'active',
      is_locked: false,
      members: [
        {
          user_id: 'user_1',
          name: 'Test Vault Owner',
          is_current_user: true,
          is_admin: true,
          contributed_amount: 5000,
        },
      ],
      withdrawal_requests: [],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    VaultAPI.list.mockResolvedValue(mockVaults);
  });

  it('renders vaults list with target and balance', async () => {
    render(<VaultScreen onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Goa Trip 2026')).toBeInTheDocument();
      expect(screen.getAllByText(/₹15,000/i)[0]).toBeInTheDocument();
      expect(screen.getByText(/50,000/)).toBeInTheDocument();
    });
  });

  it('opens contribute modal and triggers PIN entry for deposit', async () => {
    VaultAPI.contribute.mockResolvedValueOnce({ success: true });

    render(<VaultScreen onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Goa Trip 2026')).toBeInTheDocument();
    });

    // Click Contribute button
    const contributeBtn = screen.getByText('+ Contribute');
    fireEvent.click(contributeBtn);

    // Enter deposit amount
    const amountInput = screen.getByPlaceholderText('Enter amount to contribute');
    fireEvent.change(amountInput, { target: { value: '2000' } });

    // Click Continue to PIN
    fireEvent.click(screen.getByText('Enter PIN & Contribute →'));

    // PINPad appears
    await waitFor(() => {
      expect(screen.getByTestId('pin-pad')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Submit Vault PIN'));

    await waitFor(() => {
      expect(VaultAPI.contribute).toHaveBeenCalledWith('vault_1', 2000, '123456');
    });
  });

  it('opens create new vault modal and creates a vault', async () => {
    VaultAPI.create.mockResolvedValueOnce({ id: 'vault_2', name: 'New House Fund' });

    render(<VaultScreen onBack={() => {}} />);

    // Click "Create New Shared Vault" button
    const newVaultBtn = screen.getByText('Create New Shared Vault');
    fireEvent.click(newVaultBtn);

    expect(screen.getByText(/New Shared Vault/i)).toBeInTheDocument();

    const nameInput = screen.getByPlaceholderText(/e\.g\. Goa Trip Fund/i);
    const targetInput = screen.getByPlaceholderText(/e\.g\. 20000/i);
    fireEvent.change(nameInput, { target: { value: 'New House Fund' } });
    fireEvent.change(targetInput, { target: { value: '100000' } });

    fireEvent.click(screen.getByText('Create Vault'));

    await waitFor(() => {
      expect(VaultAPI.create).toHaveBeenCalledWith('New House Fund', expect.any(String), 100000, [], []);
    });
  });
});
