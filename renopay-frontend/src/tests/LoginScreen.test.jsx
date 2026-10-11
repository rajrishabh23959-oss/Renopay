import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoginScreen } from '../screens/LoginScreen';
import { AuthContext } from '../context/AuthContext';
import { AuthAPI } from '../lib/api';

vi.mock('../lib/api', () => ({
  AuthAPI: {
    register: vi.fn(),
    setPin: vi.fn(),
    sendOtp: vi.fn(),
    verifyOtp: vi.fn(),
  },
}));

describe('LoginScreen', () => {
  const mockLogin = vi.fn();
  const mockLoginWithOtp = vi.fn();
  const mockRefreshProfile = vi.fn();
  const mockOnDone = vi.fn();

  const renderWithAuth = (component, authProps = {}) => {
    return render(
      <AuthContext.Provider
        value={{
          login: mockLogin,
          loginWithOtp: mockLoginWithOtp,
          refreshProfile: mockRefreshProfile,
          ...authProps,
        }}
      >
        {component}
      </AuthContext.Provider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------
  // Email OTP Tests (Required by Task 7)
  // -------------------------------------------------------------
  it('handles email OTP happy path: sends code and verifies with auto-submit', async () => {
    AuthAPI.sendOtp.mockResolvedValueOnce({ message: 'Code sent' });
    mockLoginWithOtp.mockResolvedValueOnce();

    renderWithAuth(<LoginScreen onDone={mockOnDone} />);

    // Step 1: Email entry
    expect(screen.getByText('Instant Email Login')).toBeInTheDocument();
    const emailInput = screen.getByPlaceholderText('you@example.com');
    fireEvent.change(emailInput, { target: { value: 'user@example.com' } });

    fireEvent.click(screen.getByText('Send Verification Code →'));

    await waitFor(() => {
      expect(AuthAPI.sendOtp).toHaveBeenCalledWith('user@example.com');
      expect(screen.getByText('Verify Code')).toBeInTheDocument();
    });

    // Step 2: 6-digit OTP entry
    const firstDigit = screen.getByLabelText('Digit 1 of 6');
    expect(firstDigit).toBeInTheDocument();

    // Paste or type 6 digits
    fireEvent.change(firstDigit, { target: { value: '123456' } });

    await waitFor(() => {
      expect(mockLoginWithOtp).toHaveBeenCalledWith('user@example.com', '123456');
      expect(mockOnDone).toHaveBeenCalled();
    });
  });

  it('displays error when OTP verification fails', async () => {
    AuthAPI.sendOtp.mockResolvedValueOnce({ message: 'Code sent' });
    mockLoginWithOtp.mockRejectedValueOnce({
      response: { status: 400, data: { detail: 'Invalid or expired verification code' } },
    });

    renderWithAuth(<LoginScreen onDone={mockOnDone} />);

    // Send code
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByText('Send Verification Code →'));

    await waitFor(() => {
      expect(screen.getByText('Verify Code')).toBeInTheDocument();
    });

    // Enter wrong code
    const firstDigit = screen.getByLabelText('Digit 1 of 6');
    fireEvent.change(firstDigit, { target: { value: '999999' } });

    await waitFor(() => {
      expect(screen.getByText('Invalid or expired verification code')).toBeInTheDocument();
      expect(mockOnDone).not.toHaveBeenCalled();
    });
  });

  it('manages 30-second resend countdown and allows resending after timer elapses', async () => {
    vi.useFakeTimers();
    AuthAPI.sendOtp.mockResolvedValue({ message: 'Code sent' });

    renderWithAuth(<LoginScreen onDone={mockOnDone} />);

    // Send code initially
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'resend@example.com' },
    });
    fireEvent.click(screen.getByText('Send Verification Code →'));

    await act(async () => {
      // allow promises to resolve
    });

    expect(screen.getByText(/Resend in/i)).toBeInTheDocument();
    expect(screen.getByText(/30s/i)).toBeInTheDocument();

    // Advance 15 seconds
    act(() => {
      vi.advanceTimersByTime(15000);
    });
    expect(screen.getByText(/15s/i)).toBeInTheDocument();

    // Advance remaining 15 seconds
    act(() => {
      vi.advanceTimersByTime(15000);
    });

    // Now Resend Code button should be visible and clickable
    const resendBtn = screen.getByText('Resend Code');
    expect(resendBtn).toBeInTheDocument();

    // Click Resend
    fireEvent.click(resendBtn);

    await act(async () => {
      // resolve sendOtp
    });

    expect(AuthAPI.sendOtp).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/30s/i)).toBeInTheDocument();
  });

  // -------------------------------------------------------------
  // Mobile + PIN Flow Tests (Preserved PIN flow)
  // -------------------------------------------------------------
  it('allows switching to Mobile PIN tab and logs in with phone and PIN', async () => {
    mockLogin.mockResolvedValueOnce();

    renderWithAuth(<LoginScreen onDone={mockOnDone} />);

    // Switch to Mobile PIN
    fireEvent.click(screen.getByRole('button', { name: /Mobile PIN/i }));

    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Phone Number')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Phone Number'), { target: { value: '9999999999' } });
    fireEvent.change(screen.getByPlaceholderText('6-digit PIN (optional)'), { target: { value: '123456' } });

    fireEvent.click(screen.getByText('Log In →'));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('9999999999', '123456');
      expect(mockOnDone).toHaveBeenCalled();
    });
  });

  it('displays error on phone login failure', async () => {
    mockLogin.mockRejectedValueOnce({ response: { data: { detail: 'Invalid credentials' } } });

    renderWithAuth(<LoginScreen onDone={mockOnDone} initialMethod="phone" />);

    fireEvent.change(screen.getByPlaceholderText('Phone Number'), { target: { value: '9999999999' } });
    fireEvent.change(screen.getByPlaceholderText('6-digit PIN (optional)'), { target: { value: '123456' } });

    fireEvent.click(screen.getByText('Log In →'));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
      expect(mockOnDone).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------
  // Registration Flow Tests
  // -------------------------------------------------------------
  it('renders registration mode when initialMode is register', () => {
    renderWithAuth(<LoginScreen onDone={mockOnDone} initialMode="register" />);
    expect(screen.getByText('Welcome to RenoPay')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Full Name')).toBeInTheDocument();
  });

  it('switches to login mode when clicking login link', () => {
    renderWithAuth(<LoginScreen onDone={mockOnDone} initialMode="register" />);
    fireEvent.click(screen.getByText('Already have an account? Log in →'));

    expect(screen.getByText('Instant Email Login')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
  });

  it('submits registration directly without OTP step', async () => {
    const mockRegister = vi.fn().mockResolvedValueOnce();
    renderWithAuth(<LoginScreen onDone={mockOnDone} initialMode="register" />, {
      register: mockRegister,
    });

    fireEvent.change(screen.getByPlaceholderText('Full Name'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Phone Number'), { target: { value: '9876543210' } });

    fireEvent.click(screen.getByText('Continue →'));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith({
        full_name: 'Test User',
        phone_number: '9876543210',
        email: 'test@example.com',
        pan_number: null,
        aadhaar_number: null,
      });
      expect(mockOnDone).toHaveBeenCalled();
    });
  });
});
