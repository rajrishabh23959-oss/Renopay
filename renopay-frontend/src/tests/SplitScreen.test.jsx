import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SplitScreen } from '../screens/SplitScreen';
import { RequestAPI } from '../lib/api';

vi.mock('../lib/api', () => ({
  RequestAPI: {
    createSplit: vi.fn(),
  },
}));

const mockProfile = {
  full_name: 'Rishab Raj',
  account: {
    vpa: 'rishabhraj@renopay',
  },
};

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    profile: mockProfile,
  }),
}));

describe('SplitScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders bill splitter with initial organizer and one friend', () => {
    render(<SplitScreen onBack={() => {}} />);
    expect(screen.getByText('Bill Splitter 🍕')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('0')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Rishab Raj')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Person 2 Name')).toBeInTheDocument();
  });

  it('allows typing smoothly in participant name without input resetting', () => {
    render(<SplitScreen onBack={() => {}} />);
    const nameInput = screen.getByPlaceholderText('Person 2 Name');
    
    // Type letter by letter to verify no unmount/reset occurs
    fireEvent.change(nameInput, { target: { value: 'A' } });
    expect(screen.getByDisplayValue('A')).toBeInTheDocument();

    fireEvent.change(nameInput, { target: { value: 'Am' } });
    expect(screen.getByDisplayValue('Am')).toBeInTheDocument();

    fireEvent.change(nameInput, { target: { value: 'Amit' } });
    expect(screen.getByDisplayValue('Amit')).toBeInTheDocument();
  });

  it('applies quick UPI handle suffix chips', () => {
    render(<SplitScreen onBack={() => {}} />);
    const friendVpaInput = screen.getByPlaceholderText('their@upi or 10-digit mobile');
    fireEvent.change(friendVpaInput, { target: { value: 'amit' } });

    // Click @oksbi chip
    const sbiChip = screen.getByRole('button', { name: '@oksbi' });
    fireEvent.click(sbiChip);

    expect(screen.getByDisplayValue('amit@oksbi')).toBeInTheDocument();
  });

  it('validates bill amount and participant details before sending', async () => {
    render(<SplitScreen onBack={() => {}} />);
    const sendBtn = screen.getByRole('button', { name: /Send Split Requests/i });

    // Initially disabled because total bill is 0
    expect(sendBtn).toBeDisabled();

    // Enter bill amount
    const billInput = screen.getByPlaceholderText('0');
    fireEvent.change(billInput, { target: { value: '600' } });

    // Button is now enabled
    expect(sendBtn).not.toBeDisabled();
    fireEvent.click(sendBtn);

    // Should prompt for person 2 name
    await waitFor(() => {
      expect(screen.getByText(/Please enter a name for Person 2/i)).toBeInTheDocument();
    });
  });

  it('sends split request and shows success screen', async () => {
    RequestAPI.createSplit.mockResolvedValueOnce([
      { id: 'req-1', to_vpa: 'rishabhraj@renopay', amount: 250, note: "Bill split - Rishab Raj's share" },
      { id: 'req-2', to_vpa: 'amit@oksbi', amount: 250, note: "Bill split - Amit's share" },
    ]);

    render(<SplitScreen onBack={() => {}} />);

    // Total bill: 500
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '500' } });

    // Person 2: Amit, amit@oksbi
    fireEvent.change(screen.getByPlaceholderText('Person 2 Name'), { target: { value: 'Amit' } });
    fireEvent.change(screen.getByPlaceholderText('their@upi or 10-digit mobile'), { target: { value: 'amit@oksbi' } });

    // Click Send
    const sendBtn = screen.getByRole('button', { name: /Send Split Requests/i });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(RequestAPI.createSplit).toHaveBeenCalledWith(
        500,
        '',
        [
          { name: 'Rishab Raj', vpa: 'rishabhraj@renopay' },
          { name: 'Amit', vpa: 'amit@oksbi' },
        ]
      );
      expect(screen.getByText('Split Requests Sent!')).toBeInTheDocument();
      expect(screen.getByText('amit@oksbi')).toBeInTheDocument();
    });
  });
});
