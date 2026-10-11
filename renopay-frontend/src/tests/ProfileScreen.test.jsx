import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ProfileScreen } from '../screens/ProfileScreen';
import { AuthContext } from '../context/AuthContext';
import { AccountAPI } from '../lib/api';

vi.mock('../lib/api', () => ({
  AccountAPI: {
    trustDevice: vi.fn(),
    toggleRoundUp: vi.fn(),
    updateBudget: vi.fn(),
    updatePreferences: vi.fn().mockResolvedValue({}),
  },
  GoldAPI: {
    withdraw: vi.fn(),
  },
}));

describe('ProfileScreen', () => {
  const mockLogout = vi.fn();
  const mockRefreshProfile = vi.fn();
  const mockOnBack = vi.fn();
  
  const mockProfile = {
    full_name: 'Test User',
    kyc_status: 'verified',
    is_trusted_device: false,
    phone_number: '9999999999',
    account: {
      vpa: 'test@renopay',
      virtual_acc_no: 'RENO1234',
      ifsc_code: 'RENO0000001',
      linked_bank_name: 'State Bank of India',
      balance: 1500,
      upi_lite_balance: 500,
      digital_gold: 150.5,
      round_up_enabled: false,
      monthly_budget: 10000,
    }
  };

  const renderWithAuth = (component, profile = mockProfile) => {
    return render(
      <AuthContext.Provider value={{ profile, logout: mockLogout, refreshProfile: mockRefreshProfile }}>
        {component}
      </AuthContext.Provider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state when profile is null', () => {
    const { container } = renderWithAuth(<ProfileScreen />, null);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('renders profile details', () => {
    renderWithAuth(<ProfileScreen onBack={mockOnBack} />);
    expect(screen.getAllByText('Test User')[0]).toBeInTheDocument();
    expect(screen.getAllByText('test@renopay')[0]).toBeInTheDocument();
    expect(screen.getByText('⚠ New Device')).toBeInTheDocument();
    expect(screen.getByText(/Vault:/i)).toBeInTheDocument();
  });

  it('calls trustDevice on button click', async () => {
    AccountAPI.trustDevice.mockResolvedValueOnce();

    renderWithAuth(<ProfileScreen onBack={mockOnBack} />);
    
    fireEvent.click(screen.getByText('Trust This Device'));

    await waitFor(() => {
      expect(AccountAPI.trustDevice).toHaveBeenCalled();
      expect(mockRefreshProfile).toHaveBeenCalled();
    });
  });

  it('calls logout on logout button click', async () => {
    renderWithAuth(<ProfileScreen onBack={mockOnBack} />);
    
    fireEvent.click(screen.getByText('Logout'));

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalled();
    });
  });

  it('allows updating monthly budget', async () => {
    AccountAPI.updateBudget.mockResolvedValueOnce({ budget: 25000 });
    renderWithAuth(<ProfileScreen onBack={mockOnBack} />);

    expect(screen.getByText(/Monthly Budget/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Edit'));

    const budgetInput = screen.getByRole('spinbutton');
    fireEvent.change(budgetInput, { target: { value: '25000' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(AccountAPI.updateBudget).toHaveBeenCalledWith(25000);
    });
  });
});
