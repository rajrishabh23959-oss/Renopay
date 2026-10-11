import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PayScreen } from '../screens/PayScreen';
import { PaymentAPI } from '../lib/api';
import userEvent from '@testing-library/user-event';

vi.mock('../lib/api', () => ({
  PaymentAPI: {
    resolveVPA: vi.fn(),
    sendMoney: vi.fn(),
  },
  AnalyticsAPI: {
    downloadReport: vi.fn(),
  },
}));

// Mock the PINPad component because it's hard to test keypad input easily
vi.mock('../components/PINPad', () => ({
  PINPad: ({ onComplete }) => (
    <div data-testid="pin-pad">
      <button onClick={() => onComplete('123456')}>Submit PIN</button>
    </div>
  ),
}));

describe('PayScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders VPA input by default', () => {
    render(<PayScreen onBack={() => {}} />);
    expect(screen.getByText(/Pay to \(UPI ID\)/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('anyone@renopay')).toBeInTheDocument();
  });

  it('resolves VPA and moves to amount step', async () => {
    PaymentAPI.resolveVPA.mockResolvedValueOnce({ name: 'Test User' });

    render(<PayScreen onBack={() => {}} />);
    
    const input = screen.getByPlaceholderText('anyone@renopay');
    fireEvent.change(input, { target: { value: 'test@renopay' } });
    fireEvent.click(screen.getByText('Find & Pay →'));

    await waitFor(() => {
      expect(PaymentAPI.resolveVPA).toHaveBeenCalledWith('test@renopay');
      expect(screen.getByText('Test User')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('0')).toBeInTheDocument(); // Amount input
    });
  });

  it('handles payment success flow with remaining balance and receipt button', async () => {
    PaymentAPI.sendMoney.mockResolvedValueOnce({
      amount: 100, txn_ref: 'TXN123', round_up: 0, new_balance: 49900
    });

    render(<PayScreen onBack={() => {}} prefillVpa="test@renopay" />);
    
    // We are on amount step because of prefillVpa
    await waitFor(() => {
      expect(PaymentAPI.resolveVPA).toHaveBeenCalledWith('test@renopay');
    });

    // Enter amount and proceed
    const amountInput = screen.getByPlaceholderText('0');
    fireEvent.change(amountInput, { target: { value: '100' } });
    fireEvent.click(screen.getByText('Continue →'));

    // We are on PIN step
    await waitFor(() => {
      expect(screen.getByTestId('pin-pad')).toBeInTheDocument();
    });

    // Enter PIN
    fireEvent.click(screen.getByText('Submit PIN'));

    await waitFor(() => {
      expect(PaymentAPI.sendMoney).toHaveBeenCalled();
      expect(screen.getByText('Payment Successful!')).toBeInTheDocument();
      expect(screen.getByText(/Remaining Balance:/i)).toBeInTheDocument();
      expect(screen.getByText(/Download Receipt \(PDF\)/i)).toBeInTheDocument();
    });
  });

  it('validates amount must be greater than 0 before proceeding to PIN', async () => {
    PaymentAPI.resolveVPA.mockResolvedValueOnce({ name: 'Test User' });
    render(<PayScreen onBack={() => {}} prefillVpa="test@renopay" />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('0')).toBeInTheDocument();
    });

    const amountInput = screen.getByPlaceholderText('0');
    fireEvent.change(amountInput, { target: { value: '0' } });
    fireEvent.click(screen.getByText('Continue →'));

    expect(screen.getByText('Amount must be > 0')).toBeInTheDocument();
    expect(screen.queryByTestId('pin-pad')).not.toBeInTheDocument();
  });

  it('validates VPA format before resolving', () => {
    render(<PayScreen onBack={() => {}} />);
    const input = screen.getByPlaceholderText('anyone@renopay');
    fireEvent.change(input, { target: { value: 'invalidvpa' } });
    fireEvent.click(screen.getByText('Find & Pay →'));

    expect(screen.getByText('Enter valid VPA e.g. name@renopay')).toBeInTheDocument();
    expect(PaymentAPI.resolveVPA).not.toHaveBeenCalled();
  });

  it('displays offline warning when offline', () => {
    const originalOnline = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    render(<PayScreen onBack={() => {}} />);
    const input = screen.getByPlaceholderText('anyone@renopay');
    fireEvent.change(input, { target: { value: 'test@renopay' } });
    fireEvent.click(screen.getByText('Find & Pay →'));

    expect(screen.getByText(/You are offline/i)).toBeInTheDocument();

    Object.defineProperty(navigator, 'onLine', { value: originalOnline, configurable: true });
  });
});
