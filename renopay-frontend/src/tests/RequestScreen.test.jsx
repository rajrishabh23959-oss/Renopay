import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RequestScreen } from '../screens/RequestScreen';
import { RequestAPI } from '../lib/api';

vi.mock('../lib/api', () => ({
  RequestAPI: {
    sent: vi.fn().mockResolvedValue([]),
    inbox: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 'req_123', status: 'pending' }),
    pay: vi.fn().mockResolvedValue({ success: true }),
    decline: vi.fn().mockResolvedValue({ success: true }),
  },
}));

describe('RequestScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders request money form with tabs', async () => {
    render(<RequestScreen onBack={() => {}} />);
    expect(screen.getByText(/Request Money/i)).toBeInTheDocument();
    expect(screen.getByText('Send Request')).toBeInTheDocument();
    expect(screen.getByText(/Inbox/i)).toBeInTheDocument();
  });

  it('validates VPA format and shows error for invalid UPI ID', async () => {
    render(<RequestScreen onBack={() => {}} />);

    const vpaInput = screen.getByPlaceholderText('rishabhraj@renopay');
    const amountInput = screen.getByPlaceholderText('0');
    const submitBtn = screen.getByText('Send Request →');

    // Invalid VPA (no @ and not 10 digits)
    fireEvent.change(vpaInput, { target: { value: 'invalid_upi' } });
    fireEvent.change(amountInput, { target: { value: '500' } });
    fireEvent.click(submitBtn);

    expect(screen.getByText(/Enter a valid UPI ID/i)).toBeInTheDocument();
    expect(RequestAPI.create).not.toHaveBeenCalled();
  });

  it('validates amount must be at least ₹1', async () => {
    render(<RequestScreen onBack={() => {}} />);

    const vpaInput = screen.getByPlaceholderText('rishabhraj@renopay');
    const amountInput = screen.getByPlaceholderText('0');
    const submitBtn = screen.getByText('Send Request →');

    fireEvent.change(vpaInput, { target: { value: 'alice@renopay' } });
    fireEvent.change(amountInput, { target: { value: '0' } });
    fireEvent.click(submitBtn);

    expect(screen.getByText(/Enter valid amount \(minimum ₹1\)/i)).toBeInTheDocument();
    expect(RequestAPI.create).not.toHaveBeenCalled();
  });

  it('successfully submits valid payment request with auto-appended vpa for 10-digit phone', async () => {
    render(<RequestScreen onBack={() => {}} />);

    const vpaInput = screen.getByPlaceholderText('rishabhraj@renopay');
    const amountInput = screen.getByPlaceholderText('0');
    const noteInput = screen.getByPlaceholderText('Lunch, rent, etc.');
    const submitBtn = screen.getByText('Send Request →');

    fireEvent.change(vpaInput, { target: { value: '9876543210' } });
    fireEvent.change(amountInput, { target: { value: '250' } });
    fireEvent.change(noteInput, { target: { value: 'Dinner share' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(RequestAPI.create).toHaveBeenCalledWith('9876543210@renopay', 250, 'Dinner share');
      expect(screen.getByText(/Request sent!/i)).toBeInTheDocument();
    });
  });
});
