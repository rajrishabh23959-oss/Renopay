import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { TravelAPI } from "../lib/api";
import { fmt } from "../lib/format";
import { Card, Btn, Badge } from "../components/ui";
import { DatePickerInput } from "../components/DatePickerInput";
import { PdfPreviewModal } from "../components/PdfPreviewModal";
import { FlightIcon, BusIcon, TrainIcon, HotelIcon } from "../components/TravelIcons";
import { PaymentMethodModal } from "../components/PaymentMethodModal";

import {
  getTodayString,
  getNextDayString,
  CITY_DISTANCES,
  normalizeCity,
  lookupDistance,
} from "../data/travelData";

export function TravelScreen({ onBack, onNavigate, initialTab = "train" }) {
  const { profile, refreshProfile } = useAuth();
  const [activeTab, setActiveTab] = useState(initialTab); // "train" | "flight" | "bus" | "hotel" | "bookings"

  // Train search state
  const [trainFrom, setTrainFrom] = useState("Bihar (Patna)");
  const [trainTo, setTrainTo] = useState("Chennai Central (MAS)");
  const [trainDate, setTrainDate] = useState(getNextDayString(2));
  const [trainDistance, setTrainDistance] = useState(2075);

  // Flight search state
  const [flightFrom, setFlightFrom] = useState("Delhi (DEL)");
  const [flightTo, setFlightTo] = useState("Mumbai (BOM)");
  const [flightDate, setFlightDate] = useState(getNextDayString(3));
  const [flightClass, setFlightClass] = useState("Economy");

  // Bus search state
  const [busFrom, setBusFrom] = useState("Delhi (ISBT)");
  const [busTo, setBusTo] = useState("Jaipur (Sindhi Camp)");
  const [busDate, setBusDate] = useState(getNextDayString(1));
  const [busDistance, setBusDistance] = useState(280);

  // Hotel search state
  const [hotelCity, setHotelCity] = useState("Goa");
  const [checkInDate, setCheckInDate] = useState(getNextDayString(2));
  const [checkOutDate, setCheckOutDate] = useState(getNextDayString(4));
  const [guestsCount, setGuestsCount] = useState(2);
  const [roomsCount, setRoomsCount] = useState(1);

  // Checkout modal state
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [passengerName, setPassengerName] = useState(profile?.full_name || "");
  const [passengerAge, setPassengerAge] = useState(28);
  const [passengerGender, setPassengerGender] = useState("Male");
  const [berthPreference, setBerthPreference] = useState("No Preference");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState("");

  // Confirmed ticket modal state
  const [confirmedBooking, setConfirmedBooking] = useState(null);

  // PDF Preview modal state
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewBlob, setPreviewBlob] = useState(null);
  const [previewTitle, setPreviewTitle] = useState("Travel E-Ticket");
  const [previewFilename, setPreviewFilename] = useState("ticket.pdf");
  const [loadingPdf, setLoadingPdf] = useState(false);

  // My Bookings state
  const [myBookings, setMyBookings] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(false);

  // Load bookings from backend
  const loadBookings = async () => {
    setLoadingBookings(true);
    try {
      const res = await TravelAPI.getBookings(30);
      setMyBookings(res);
    } catch (e) {
      console.error("Failed to load bookings:", e);
    } finally {
      setLoadingBookings(false);
    }
  };

  useEffect(() => {
    loadBookings();
  }, []);

  useEffect(() => {
    if (activeTab === "bookings") {
      loadBookings();
    }
  }, [activeTab]);

  // Automatic distance calculation from static lookup table
  useEffect(() => {
    const dist = lookupDistance(trainFrom, trainTo);
    if (dist > 0) setTrainDistance(dist);
  }, [trainFrom, trainTo]);

  useEffect(() => {
    const dist = lookupDistance(busFrom, busTo);
    if (dist > 0) setBusDistance(dist);
  }, [busFrom, busTo]);

  // Quick route apply helper
  const applyQuickRoute = (from, to) => {
    setTrainFrom(from);
    setTrainTo(to);
    const d = lookupDistance(from, to);
    if (d > 0) setTrainDistance(d);
  };

  // Handle PDF View
  const handleViewTicket = async (booking) => {
    setLoadingPdf(true);
    setPreviewTitle(`E-Ticket - ${booking.pnr_or_ticket_no}`);
    setPreviewFilename(`Ticket_${booking.pnr_or_ticket_no}.pdf`);
    setPreviewBlob(null);
    setPreviewModalOpen(true);
    try {
      const blob = await TravelAPI.getTicketPdf(booking.id);
      setPreviewBlob(blob);
    } catch (e) {
      alert("Failed to render ticket PDF: " + (e?.response?.data?.detail || e.message));
      setPreviewModalOpen(false);
    } finally {
      setLoadingPdf(false);
    }
  };

  // Handle PDF Download
  const handleDownloadTicket = async (booking) => {
    try {
      const blob = await TravelAPI.getTicketPdf(booking.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Ticket_${booking.pnr_or_ticket_no}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Failed to download ticket PDF: " + (e?.response?.data?.detail || e.message));
    }
  };

  // Calculate nights for hotel
  const hotelNights = useMemo(() => {
    try {
      const d1 = new Date(checkInDate);
      const d2 = new Date(checkOutDate);
      const diff = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
      return diff;
    } catch (_) {
      return 1;
    }
  }, [checkInDate, checkOutDate]);

  // Train rate formula as requested:
  // Sleeper (SL): 0.7 Rs / km
  // 3rd AC (3A): 1.2 Rs / km
  // 2nd AC (2A): 2.0 Rs / km
  // 1st AC (1A): 3.0 Rs / km
  const trainOptions = useMemo(() => {
    const dist = trainDistance > 0 ? trainDistance : 500;
    const hours = Math.max(2, Math.round(dist / 65));
    const mins = Math.round(((dist % 65) / 65) * 60);
    const calcDuration = `${hours}h ${mins > 0 ? (mins < 10 ? "0" + mins : mins) + "m" : "15m"}`;

    // Specific route: Bihar / Patna to Chennai
    const isBiharChennai =
      (trainFrom.toLowerCase().includes("bihar") || trainFrom.toLowerCase().includes("patna")) &&
      trainTo.toLowerCase().includes("chennai");

    if (isBiharChennai) {
      return [
        {
          trainNo: "12296",
          name: "Sanghamitra Superfast Exp",
          depart: "08:15 PM",
          arrive: "06:45 AM (Day 3)",
          duration: "34h 30m",
          classes: [
            { code: "SL", label: "Sleeper", ratePerKm: 0.7, price: Math.round(dist * 0.7), seats: "AVL 114" },
            { code: "3A", label: "3rd AC", ratePerKm: 1.2, price: Math.round(dist * 1.2), seats: "AVL 48" },
            { code: "2A", label: "2nd AC", ratePerKm: 2.0, price: Math.round(dist * 2.0), seats: "AVL 14" },
            { code: "1A", label: "1st AC", ratePerKm: 3.0, price: Math.round(dist * 3.0), seats: "AVL 04" },
          ],
        },
        {
          trainNo: "12577",
          name: "Bagmati Superfast Express",
          depart: "07:20 AM",
          arrive: "07:15 PM (Day 2)",
          duration: "35h 55m",
          classes: [
            { code: "SL", label: "Sleeper", ratePerKm: 0.7, price: Math.round(dist * 0.7), seats: "RAC 08" },
            { code: "3A", label: "3rd AC", ratePerKm: 1.2, price: Math.round(dist * 1.2), seats: "AVL 24" },
            { code: "2A", label: "2nd AC", ratePerKm: 2.0, price: Math.round(dist * 2.0), seats: "AVL 06" },
          ],
        },
        {
          trainNo: "22644",
          name: "Patna - Ernakulam Superfast",
          depart: "02:00 PM",
          arrive: "11:55 PM (Day 2)",
          duration: "33h 55m",
          classes: [
            { code: "SL", label: "Sleeper", ratePerKm: 0.7, price: Math.round(dist * 0.7), seats: "AVL 52" },
            { code: "3A", label: "3rd AC", ratePerKm: 1.2, price: Math.round(dist * 1.2), seats: "AVL 18" },
            { code: "2A", label: "2nd AC", ratePerKm: 2.0, price: Math.round(dist * 2.0), seats: "AVL 08" },
          ],
        },
        {
          trainNo: "22353",
          name: "Patna - SMVT Humsafar Exp",
          depart: "08:25 PM",
          arrive: "06:50 AM (Day 3)",
          duration: "34h 25m",
          classes: [
            { code: "3A", label: "3rd AC", ratePerKm: 1.2, price: Math.round(dist * 1.2), seats: "AVL 64" },
            { code: "2A", label: "2nd AC", ratePerKm: 2.0, price: Math.round(dist * 2.0), seats: "AVL 20" },
          ],
        },
      ];
    }

    return [
      {
        trainNo: "22436",
        name: "Vande Bharat Express",
        depart: "06:00 AM",
        arrive: "02:00 PM",
        duration: calcDuration,
        classes: [
          { code: "SL", label: "Sleeper", ratePerKm: 0.7, price: Math.round(dist * 0.7), seats: "AVL 80" },
          { code: "3A", label: "3rd AC", ratePerKm: 1.2, price: Math.round(dist * 1.2), seats: "AVL 48" },
          { code: "2A", label: "2nd AC", ratePerKm: 2.0, price: Math.round(dist * 2.0), seats: "AVL 16" },
        ],
      },
      {
        trainNo: "12952",
        name: "Tejas Rajdhani Express",
        depart: "04:55 PM",
        arrive: "08:35 AM",
        duration: calcDuration,
        classes: [
          { code: "3A", label: "3rd AC", ratePerKm: 1.2, price: Math.round(dist * 1.2), seats: "AVL 32" },
          { code: "2A", label: "2nd AC", ratePerKm: 2.0, price: Math.round(dist * 2.0), seats: "AVL 14" },
          { code: "1A", label: "1st AC", ratePerKm: 3.0, price: Math.round(dist * 3.0), seats: "AVL 04" },
        ],
      },
      {
        trainNo: "12004",
        name: "Shatabdi Express",
        depart: "06:10 AM",
        arrive: "11:45 AM",
        duration: calcDuration,
        classes: [
          { code: "SL", label: "Sleeper", ratePerKm: 0.7, price: Math.round(dist * 0.7), seats: "AVL 120" },
          { code: "3A", label: "3rd AC", ratePerKm: 1.2, price: Math.round(dist * 1.2), seats: "AVL 45" },
          { code: "2A", label: "2nd AC", ratePerKm: 2.0, price: Math.round(dist * 2.0), seats: "AVL 18" },
        ],
      },
      {
        trainNo: "12398",
        name: "Mahabodhi Superfast Exp",
        depart: "12:50 PM",
        arrive: "09:10 PM",
        duration: calcDuration,
        classes: [
          { code: "SL", label: "Sleeper", ratePerKm: 0.7, price: Math.round(dist * 0.7), seats: "RAC 12" },
          { code: "3A", label: "3rd AC", ratePerKm: 1.2, price: Math.round(dist * 1.2), seats: "AVL 28" },
          { code: "2A", label: "2nd AC", ratePerKm: 2.0, price: Math.round(dist * 2.0), seats: "AVL 09" },
          { code: "1A", label: "1st AC", ratePerKm: 3.0, price: Math.round(dist * 3.0), seats: "AVL 02" },
        ],
      },
    ];
  }, [trainDistance, trainFrom, trainTo]);

  // Demo Flights
  const flightOptions = useMemo(() => {
    const multiplier = flightClass === "Business" ? 2.5 : flightClass === "Premium Economy" ? 1.5 : 1.0;
    return [
      {
        carrier: "IndiGo",
        code: "6E-204",
        depart: "07:15 AM",
        arrive: "09:30 AM",
        duration: "2h 15m",
        type: "Non-stop",
        basePrice: Math.round(4199 * multiplier),
      },
      {
        carrier: "Air India",
        code: "AI-805",
        depart: "10:30 AM",
        arrive: "12:45 PM",
        duration: "2h 15m",
        type: "Non-stop",
        basePrice: Math.round(4650 * multiplier),
      },
      {
        carrier: "Vistara",
        code: "UK-995",
        depart: "03:40 PM",
        arrive: "05:45 PM",
        duration: "2h 05m",
        type: "Non-stop",
        basePrice: Math.round(5250 * multiplier),
      },
      {
        carrier: "Akasa Air",
        code: "QP-1322",
        depart: "08:00 PM",
        arrive: "10:20 PM",
        duration: "2h 20m",
        type: "Non-stop",
        basePrice: Math.round(3899 * multiplier),
      },
    ];
  }, [flightClass]);

  // Demo Buses (with per KM rate)
  const busOptions = useMemo(() => {
    const dist = busDistance > 0 ? busDistance : 280;
    return [
      {
        operator: "Zingbus Electric",
        type: "AC Seater (2+2)",
        depart: "07:00 AM",
        arrive: "12:30 PM",
        duration: "5h 30m",
        rating: "4.7★",
        price: Math.round(dist * 1.2),
        amenities: ["WiFi", "Live Tracking", "Water"],
      },
      {
        operator: "IntrCity SmartBus",
        type: "AC Sleeper (2+1)",
        depart: "10:30 PM",
        arrive: "05:00 AM",
        duration: "6h 30m",
        rating: "4.8★",
        price: Math.round(dist * 1.6),
        amenities: ["Blanket", "Charging", "Snacks"],
      },
      {
        operator: "NueGo Eco Express",
        type: "Electric AC Luxury",
        depart: "02:15 PM",
        arrive: "07:30 PM",
        duration: "5h 15m",
        rating: "4.6★",
        price: Math.round(dist * 1.4),
        amenities: ["Clean Air", "CCTV", "WiFi"],
      },
      {
        operator: "SRS Travels",
        type: "Volvo Multi-Axle",
        depart: "11:15 PM",
        arrive: "05:45 AM",
        duration: "6h 30m",
        rating: "4.5★",
        price: Math.round(dist * 2.0),
        amenities: ["Recliner", "Water", "USB"],
      },
    ];
  }, [busDistance]);

  // Demo Hotels
  const hotelOptions = useMemo(() => {
    return [
      {
        name: "The Grand Heritage & Spa",
        city: hotelCity,
        location: "Beachfront / Central",
        rating: "4.9★",
        reviews: "1,240 reviews",
        roomTypes: [
          { type: "Deluxe Ocean View", pricePerNight: 2899, total: 2899 * hotelNights * roomsCount },
          { type: "Executive Pool Suite", pricePerNight: 4499, total: 4499 * hotelNights * roomsCount },
        ],
        tags: ["Free Breakfast", "Swimming Pool", "Couple Friendly"],
      },
      {
        name: "Radisson Blu Resort",
        city: hotelCity,
        location: "Prime City Hub",
        rating: "4.7★",
        reviews: "890 reviews",
        roomTypes: [
          { type: "Standard Cozy Room", pricePerNight: 1899, total: 1899 * hotelNights * roomsCount },
          { type: "Deluxe King Room", pricePerNight: 2499, total: 2499 * hotelNights * roomsCount },
        ],
        tags: ["Free Wi-Fi", "Free Cancellation", "Gym"],
      },
      {
        name: "Urban Oasis Boutique Hotel",
        city: hotelCity,
        location: "Near City Market",
        rating: "4.6★",
        reviews: "640 reviews",
        roomTypes: [
          { type: "Superior City View", pricePerNight: 1499, total: 1499 * hotelNights * roomsCount },
          { type: "Family Luxury Suite", pricePerNight: 3199, total: 3199 * hotelNights * roomsCount },
        ],
        tags: ["24/7 Room Service", "Restaurant"],
      },
    ];
  }, [hotelCity, hotelNights, roomsCount]);

  // Initiate Booking
  const openBookingModal = (bookingData) => {
    setSelectedBooking(bookingData);
    setShowPaymentModal(false);
    setPin("");
    setBookingError("");
  };

  // Submit Booking
  const handleConfirmBooking = async (enteredPin, mode = "normal") => {
    if (!selectedBooking) return;
    setBookingError("");

    if (!passengerName.trim()) {
      setBookingError("Please enter passenger/guest name");
      return;
    }

    if (profile?.has_upi_pin && !enteredPin) {
      setBookingError("Please enter your 6-digit UPI PIN");
      return;
    }

    if ((profile?.account?.balance ?? 0) < selectedBooking.amount) {
      setBookingError("Insufficient wallet balance. Please add money to RenoPay wallet.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        booking_type: selectedBooking.type,
        operator_name: selectedBooking.operator,
        service_number: selectedBooking.serviceNumber || null,
        from_location: selectedBooking.from,
        to_location: selectedBooking.to,
        departure_date: selectedBooking.departDate,
        departure_time: selectedBooking.departTime || null,
        arrival_date: selectedBooking.arriveDate || null,
        arrival_time: selectedBooking.arriveTime || null,
        distance_km: selectedBooking.distance || 0,
        travel_class: selectedBooking.travelClass,
        passenger_name: passengerName.trim(),
        passenger_age: Number(passengerAge) || 28,
        passenger_gender: passengerGender,
        seat_or_room_no: selectedBooking.seatOrRoom || (selectedBooking.type === "train" ? `B2 - ${Math.floor(Math.random() * 60) + 1} (${berthPreference})` : selectedBooking.type === "hotel" ? `Room ${Math.floor(Math.random() * 300) + 101}` : `${Math.floor(Math.random() * 25) + 1}A`),
        amount: selectedBooking.amount,
        pin: enteredPin || null,
      };

      const result = await TravelAPI.book(payload);
      await refreshProfile?.();
      await loadBookings();
      setShowPaymentModal(false);
      setSelectedBooking(null);
      setConfirmedBooking(result);
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.detail || err.message || "Booking failed";
      setBookingError(typeof msg === "object" ? msg.message || JSON.stringify(msg) : msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg pb-[100px] text-textLight">
      {/* Top Header */}
      <div className="px-[22px] pt-[46px] pb-[16px] flex items-center justify-between border-b border-line bg-surf/60 sticky top-0 z-20 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-xl bg-card border border-line flex items-center justify-center text-textLight hover:border-accent/40 active:scale-95 transition-all"
            title="Go back"
          >
            ←
          </button>
          <div>
            <h2 className="text-[19px] font-extrabold text-textLight leading-tight">Travel & Transit</h2>
            <p className="text-[11px] text-muted">Direct Route Search & Instant Wallet Booking</p>
          </div>
        </div>

        <button
          onClick={() => setActiveTab("bookings")}
          className={`px-3 py-1.5 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 transition-all ${
            activeTab === "bookings" ? "bg-accent text-white border-accent shadow-accentGlow" : "bg-card border-line text-muted hover:text-textLight"
          }`}
        >
          <span>🎟️</span>
          <span>My Tickets</span>
          {myBookings.length > 0 && (
            <span className="w-4 h-4 rounded-full bg-white text-accent flex items-center justify-center text-[9px] font-extrabold ml-0.5">
              {myBookings.length}
            </span>
          )}
        </button>
      </div>

      {/* Prominent My Bookings Section at Top */}
      <div className="px-[20px] pt-3 pb-1">
        <button
          onClick={() => setActiveTab("bookings")}
          className={`w-full rounded-2xl p-3 flex items-center justify-between border transition-all cursor-pointer shadow-sm ${
            activeTab === "bookings"
              ? "bg-accent/15 border-accent text-accent"
              : "bg-card hover:bg-card/80 border-accent/30 text-textLight"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <span className="text-2xl p-1.5 rounded-xl bg-accent/15 text-accent">🎟️</span>
            <div className="text-left">
              <h4 className="text-xs font-extrabold flex items-center gap-1.5 text-textLight">
                My Bookings & Stored Tickets
                {myBookings.length > 0 ? (
                  <span className="bg-accent text-white px-2 py-0.5 rounded-full text-[10px] font-bold">
                    {myBookings.length} Booked
                  </span>
                ) : (
                  <span className="text-muted text-[10px] font-normal">(0 stored)</span>
                )}
              </h4>
              <p className="text-[10px] text-muted">Tap to view, verify PNR, or re-download PDF boarding passes</p>
            </div>
          </div>
          <span className="text-accent text-xs font-bold flex items-center gap-0.5">
            {activeTab === "bookings" ? "Viewing" : "Open"} ➔
          </span>
        </button>
      </div>

      <div className="px-[20px] pt-2">
        {/* Service Tab Switcher (Flight, Bus, Train, Hotel) */}
        <div className="grid grid-cols-4 gap-2 mb-3.5 bg-card p-1.5 rounded-2xl border border-line">
          {[
            { key: "train", label: "Train", icon: TrainIcon },
            { key: "flight", label: "Flight", icon: FlightIcon },
            { key: "bus", label: "Bus", icon: BusIcon },
            { key: "hotel", label: "Hotel", icon: HotelIcon },
          ].map((tab) => {
            const Icon = tab.icon;
            const isSel = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key);
                  setConfirmedBooking(null);
                }}
                className={`flex flex-col items-center py-2 px-1 rounded-xl transition-all cursor-pointer ${
                  isSel ? "bg-accent text-white shadow-accentGlow scale-[1.02]" : "hover:bg-surf text-muted hover:text-textLight"
                }`}
              >
                <Icon className="w-7 h-7 mb-1" />
                <span className={`text-[11px] font-bold ${isSel ? "text-white" : ""}`}>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* ===================== TAB 1: TRAIN ===================== */}
        {activeTab === "train" && (
          <div className="space-y-4 animate-fadeUp">
            <Card className="p-4 border-line">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-accent uppercase tracking-wider flex items-center gap-1.5">
                  <span>🚆</span> IRCTC Train Booking
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold flex items-center gap-1">
                  <span>⚡</span>
                  <span>Instant Rates</span>
                </span>
              </div>

              {/* Free text search inputs */}
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] uppercase font-bold text-muted block mb-1">
                    From City / Station (Type any location)
                  </label>
                  <input
                    type="text"
                    value={trainFrom}
                    onChange={(e) => setTrainFrom(e.target.value)}
                    placeholder="e.g. Bihar, Patna, Delhi, Lucknow..."
                    className="w-full bg-surf border border-line rounded-xl px-3 py-2 text-xs text-textLight font-semibold outline-none focus:border-accent"
                  />
                </div>

                <div className="flex items-center justify-center -my-1 relative z-10">
                  <button
                    type="button"
                    onClick={() => {
                      const temp = trainFrom;
                      setTrainFrom(trainTo);
                      setTrainTo(temp);
                    }}
                    className="w-7 h-7 rounded-full bg-accent text-white flex items-center justify-center text-xs shadow-md hover:scale-110 active:scale-90 transition-transform"
                    title="Swap stations"
                  >
                    ⇅
                  </button>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-muted block mb-1">
                    To City / Station (Type any location)
                  </label>
                  <input
                    type="text"
                    value={trainTo}
                    onChange={(e) => setTrainTo(e.target.value)}
                    placeholder="e.g. Chennai, Mumbai, Bangalore..."
                    className="w-full bg-surf border border-line rounded-xl px-3 py-2 text-xs text-textLight font-semibold outline-none focus:border-accent"
                  />
                </div>
              </div>

              {/* Quick Suggestion Chips */}
              <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-1 text-[10px] no-scrollbar">
                <span className="text-muted text-[9px] uppercase font-bold shrink-0">Popular:</span>
                {[
                  ["Bihar (Patna)", "Chennai Central"],
                  ["Delhi", "Mumbai Central"],
                  ["Patna", "New Delhi"],
                  ["Bengaluru", "Goa"],
                ].map(([f, t], idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => applyQuickRoute(f, t)}
                    className="bg-surf hover:bg-accent/20 border border-line hover:border-accent text-textLight/80 px-2 py-0.5 rounded-lg whitespace-nowrap transition-colors shrink-0"
                  >
                    {f} ➔ {t}
                  </button>
                ))}
              </div>

              {/* Date & Distance Strip */}
              <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-line/60">
                <div>
                  <label className="text-[10px] uppercase font-bold text-muted block mb-1">Journey Date 📅</label>
                  <DatePickerInput
                    value={trainDate}
                    onChange={(e) => setTrainDate(e.target.value)}
                    title="Select Journey Date"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase font-bold text-muted block">Real Track Distance</label>
                    <span className="text-[9px] text-accent font-bold">Standard Railway Route</span>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      value={trainDistance}
                      onChange={(e) => setTrainDistance(Math.max(10, Number(e.target.value) || 0))}
                      className="w-full bg-surf border border-line rounded-xl px-3 py-1.5 text-xs text-textLight font-mono font-bold outline-none focus:border-accent"
                    />
                    <span className="absolute right-2.5 top-2 text-[10px] text-muted font-bold">KM</span>
                  </div>
                </div>
              </div>

              {/* Rate Card Legend */}
              <div className="mt-2.5 p-2 rounded-xl bg-surf border border-line flex items-center justify-between text-[10px] font-semibold text-textLight flex-wrap gap-1">
                <span>SL: <strong className="text-accent">₹0.7/km</strong></span>
                <span>3A: <strong className="text-accent">₹1.2/km</strong></span>
                <span>2A: <strong className="text-accent">₹2/km</strong></span>
                <span>1A: <strong className="text-accent">₹3/km</strong></span>
              </div>
            </Card>

            {/* Train Results */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-muted uppercase tracking-wider px-1 flex items-center justify-between">
                <span>Available Trains ({trainOptions.length}) &bull; {trainDistance} KM</span>
                <span className="text-[10px] text-accent font-semibold">{trainFrom} ➔ {trainTo}</span>
              </h3>

              {trainOptions.map((train) => (
                <Card key={train.trainNo} className="p-3.5 border-line hover:border-accent/40 transition-all">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-[14px] text-textLight">{train.name}</span>
                        <Badge color="#FF6A1A" size={9}>#{train.trainNo}</Badge>
                      </div>
                      <p className="text-[11px] text-muted mt-0.5">Runs on schedule &bull; Punctual</p>
                    </div>
                    <span className="text-[11px] font-mono font-bold text-accent">{train.duration}</span>
                  </div>

                  {/* Timings */}
                  <div className="flex items-center justify-between py-2 border-y border-line/40 text-xs my-2">
                    <div>
                      <p className="font-bold text-sm text-textLight">{train.depart}</p>
                      <p className="text-[10px] text-muted truncate max-w-[120px]">{trainFrom}</p>
                    </div>
                    <div className="text-center">
                      <span className="text-[10px] text-muted block">&#10230;</span>
                      <span className="text-[9px] text-accent font-bold">{trainDistance} KM</span>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-sm text-textLight">{train.arrive}</p>
                      <p className="text-[10px] text-muted truncate max-w-[120px]">{trainTo}</p>
                    </div>
                  </div>

                  {/* Class options with exact requested formula */}
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 mt-2">
                    {train.classes.map((cls) => (
                      <button
                        key={cls.code}
                        onClick={() =>
                          openBookingModal({
                            type: "train",
                            operator: `${train.trainNo} ${train.name}`,
                            serviceNumber: train.trainNo,
                            from: trainFrom,
                            to: trainTo,
                            departDate: trainDate,
                            departTime: train.depart,
                            arriveTime: train.arrive,
                            distance: trainDistance,
                            travelClass: `${cls.label} (${cls.code})`,
                            amount: cls.price,
                            rateDesc: `${trainDistance} km × ₹${cls.ratePerKm}/km`,
                          })
                        }
                        className="bg-surf hover:bg-accent/15 border border-line hover:border-accent rounded-xl p-2 text-left transition-all active:scale-95 group cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-extrabold text-textLight group-hover:text-accent">{cls.code}</span>
                          <span className="text-[9px] text-emerald-400 font-bold">{cls.seats}</span>
                        </div>
                        <p className="text-[13px] font-mono font-extrabold text-textLight mt-1">{fmt(cls.price)}</p>
                        <p className="text-[9px] text-muted">₹{cls.ratePerKm}/km</p>
                      </button>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ===================== TAB 2: FLIGHT ===================== */}
        {activeTab === "flight" && (
          <div className="space-y-4 animate-fadeUp">
            <Card className="p-4 border-line">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">✈️ Domestic Flights</span>
                <span className="text-[10px] text-muted">Direct Airline Partner Rates</span>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <label className="text-[10px] uppercase font-bold text-muted block mb-1">From Airport</label>
                  <input
                    type="text"
                    value={flightFrom}
                    onChange={(e) => setFlightFrom(e.target.value)}
                    placeholder="e.g. Delhi (DEL), Patna (PAT)..."
                    className="w-full bg-surf border border-line rounded-xl px-2.5 py-2 text-xs text-textLight font-semibold outline-none focus:border-accent"
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-muted block mb-1">To Airport</label>
                  <input
                    type="text"
                    value={flightTo}
                    onChange={(e) => setFlightTo(e.target.value)}
                    placeholder="e.g. Chennai (MAA), Mumbai (BOM)..."
                    className="w-full bg-surf border border-line rounded-xl px-2.5 py-2 text-xs text-textLight font-semibold outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-line/60">
                <div>
                  <label className="text-[10px] uppercase font-bold text-muted block mb-1">Date 📅</label>
                  <DatePickerInput
                    value={flightDate}
                    onChange={(e) => setFlightDate(e.target.value)}
                    title="Departure Date"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-muted block mb-1">Cabin Class</label>
                  <select
                    value={flightClass}
                    onChange={(e) => setFlightClass(e.target.value)}
                    className="w-full bg-surf border border-line rounded-xl px-2.5 py-1.5 text-xs text-textLight font-semibold outline-none focus:border-accent"
                  >
                    <option value="Economy">Economy</option>
                    <option value="Premium Economy">Premium Economy</option>
                    <option value="Business">Business Class</option>
                  </select>
                </div>
              </div>
            </Card>

            {/* Flight Results */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-muted uppercase tracking-wider px-1">
                Available Flights ({flightOptions.length}) &bull; {flightClass}
              </h3>

              {flightOptions.map((f) => (
                <Card key={f.code} className="p-3.5 border-line hover:border-accent/40 transition-all">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="font-extrabold text-[14px] text-textLight">{f.carrier}</p>
                      <p className="text-[10px] text-muted font-mono">{f.code} &bull; {f.type}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[16px] font-mono font-extrabold text-accent">{fmt(f.basePrice)}</p>
                      <p className="text-[9px] text-muted">per adult (taxes incl.)</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between py-2 border-y border-line/40 text-xs my-2">
                    <div>
                      <p className="font-bold text-sm text-textLight">{f.depart}</p>
                      <p className="text-[10px] text-muted">{flightFrom}</p>
                    </div>
                    <div className="text-center">
                      <span className="text-[10px] text-muted block">{f.duration}</span>
                      <span className="text-[9px] text-emerald-400 font-semibold">{f.type}</span>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-sm text-textLight">{f.arrive}</p>
                      <p className="text-[10px] text-muted">{flightTo}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-2 pt-1">
                    <span className="text-[10px] text-muted">🧳 15 Kg Check-in &bull; 7 Kg Cabin</span>
                    <Btn
                      variant="teal"
                      className="py-1.5 px-4 text-xs font-bold"
                      onClick={() =>
                        openBookingModal({
                          type: "flight",
                          operator: f.carrier,
                          serviceNumber: f.code,
                          from: flightFrom,
                          to: flightTo,
                          departDate: flightDate,
                          departTime: f.depart,
                          arriveTime: f.arrive,
                          travelClass: flightClass,
                          amount: f.basePrice,
                          distance: 1150,
                          rateDesc: "Airfare tariff",
                        })
                      }
                    >
                      Book Flight
                    </Btn>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ===================== TAB 3: BUS ===================== */}
        {activeTab === "bus" && (
          <div className="space-y-4 animate-fadeUp">
            <Card className="p-4 border-line">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-red-400 uppercase tracking-wider">🚌 Intercity Bus Tickets</span>
                <span className="text-[10px] text-muted">Fixed Distance Tariff</span>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <label className="text-[10px] uppercase font-bold text-muted block mb-1">From City</label>
                  <input
                    type="text"
                    value={busFrom}
                    onChange={(e) => setBusFrom(e.target.value)}
                    placeholder="e.g. Delhi, Jaipur, Patna..."
                    className="w-full bg-surf border border-line rounded-xl px-2.5 py-2 text-xs text-textLight font-semibold outline-none focus:border-accent"
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-muted block mb-1">To City</label>
                  <input
                    type="text"
                    value={busTo}
                    onChange={(e) => setBusTo(e.target.value)}
                    placeholder="e.g. Jaipur, Lucknow, Agra..."
                    className="w-full bg-surf border border-line rounded-xl px-2.5 py-2 text-xs text-textLight font-semibold outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-line/60">
                <div>
                  <label className="text-[10px] uppercase font-bold text-muted block mb-1">Date 📅</label>
                  <DatePickerInput
                    value={busDate}
                    onChange={(e) => setBusDate(e.target.value)}
                    title="Journey Date"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-muted block mb-1">Distance (KM)</label>
                  <input
                    type="number"
                    value={busDistance}
                    onChange={(e) => setBusDistance(Math.max(10, Number(e.target.value) || 0))}
                    className="w-full bg-surf border border-line rounded-xl px-3 py-1.5 text-xs text-textLight font-mono font-bold outline-none focus:border-accent"
                  />
                </div>
              </div>
            </Card>

            {/* Bus Results */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-muted uppercase tracking-wider px-1">
                Available Buses ({busOptions.length}) &bull; {busDistance} KM
              </h3>

              {busOptions.map((b, i) => (
                <Card key={i} className="p-3.5 border-line hover:border-accent/40 transition-all">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-extrabold text-[14px] text-textLight">{b.operator}</p>
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-bold">{b.rating}</span>
                      </div>
                      <p className="text-[11px] text-muted">{b.type}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[16px] font-mono font-extrabold text-accent">{fmt(b.price)}</p>
                      <p className="text-[9px] text-muted">seat fare</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between py-2 border-y border-line/40 text-xs my-2">
                    <div>
                      <p className="font-bold text-sm text-textLight">{b.depart}</p>
                      <p className="text-[10px] text-muted">{busFrom}</p>
                    </div>
                    <div className="text-center">
                      <span className="text-[10px] text-muted block">{b.duration}</span>
                      <span className="text-[9px] text-accent font-semibold">{busDistance} KM</span>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-sm text-textLight">{b.arrive}</p>
                      <p className="text-[10px] text-muted">{busTo}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-2 pt-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {b.amenities.map((a, ai) => (
                        <span key={ai} className="text-[9px] bg-surf px-2 py-0.5 rounded text-muted">
                          {a}
                        </span>
                      ))}
                    </div>
                    <Btn
                      variant="teal"
                      className="py-1.5 px-4 text-xs font-bold"
                      onClick={() =>
                        openBookingModal({
                          type: "bus",
                          operator: b.operator,
                          from: busFrom,
                          to: busTo,
                          departDate: busDate,
                          departTime: b.depart,
                          arriveTime: b.arrive,
                          distance: busDistance,
                          travelClass: b.type,
                          amount: b.price,
                          rateDesc: `${busDistance} km route`,
                        })
                      }
                    >
                      Book Seat
                    </Btn>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ===================== TAB 4: HOTEL ===================== */}
        {activeTab === "hotel" && (
          <div className="space-y-4 animate-fadeUp">
            <Card className="p-4 border-line">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">🏨 Hotel Reservations</span>
                <span className="text-[10px] text-muted">Instant Voucher & Check-in</span>
              </div>

              <div className="mb-3">
                <label className="text-[10px] uppercase font-bold text-muted block mb-1">Destination City</label>
                <input
                  type="text"
                  value={hotelCity}
                  onChange={(e) => setHotelCity(e.target.value)}
                  placeholder="e.g. Goa, Jaipur, Mumbai, Manali..."
                  className="w-full bg-surf border border-line rounded-xl px-3 py-2 text-xs text-textLight font-semibold outline-none focus:border-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <label className="text-[10px] uppercase font-bold text-muted block mb-1">Check-in 📅</label>
                  <DatePickerInput
                    value={checkInDate}
                    onChange={(e) => setCheckInDate(e.target.value)}
                    title="Check-in Date"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-muted block mb-1">Check-out 📅</label>
                  <DatePickerInput
                    value={checkOutDate}
                    onChange={(e) => setCheckOutDate(e.target.value)}
                    title="Check-out Date"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-line/60">
                <div>
                  <label className="text-[10px] uppercase font-bold text-muted block mb-1">Guests</label>
                  <select
                    value={guestsCount}
                    onChange={(e) => setGuestsCount(Number(e.target.value))}
                    className="w-full bg-surf border border-line rounded-xl px-2.5 py-1.5 text-xs text-textLight font-semibold outline-none focus:border-accent"
                  >
                    <option value={1}>1 Guest</option>
                    <option value={2}>2 Guests</option>
                    <option value={3}>3 Guests</option>
                    <option value={4}>4 Guests</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-muted block mb-1">Rooms</label>
                  <select
                    value={roomsCount}
                    onChange={(e) => setRoomsCount(Number(e.target.value))}
                    className="w-full bg-surf border border-line rounded-xl px-2.5 py-1.5 text-xs text-textLight font-semibold outline-none focus:border-accent"
                  >
                    <option value={1}>1 Room</option>
                    <option value={2}>2 Rooms</option>
                    <option value={3}>3 Rooms</option>
                  </select>
                </div>
              </div>
            </Card>

            {/* Hotel Results */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-muted uppercase tracking-wider px-1">
                Properties in {hotelCity} &bull; {hotelNights} {hotelNights === 1 ? "Night" : "Nights"}
              </h3>

              {hotelOptions.map((h, i) => (
                <Card key={i} className="p-3.5 border-line hover:border-accent/40 transition-all">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-extrabold text-[14px] text-textLight">{h.name}</p>
                        <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-bold">{h.rating}</span>
                      </div>
                      <p className="text-[11px] text-muted mt-0.5">{h.location}, {h.city} &bull; {h.reviews}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 my-2 flex-wrap">
                    {h.tags.map((t, ti) => (
                      <span key={ti} className="text-[9px] bg-surf text-textLight/70 px-2 py-0.5 rounded border border-line">
                        ✓ {t}
                      </span>
                    ))}
                  </div>

                  <div className="space-y-2 pt-2 border-t border-line/40">
                    {h.roomTypes.map((rt, rti) => (
                      <div key={rti} className="flex items-center justify-between bg-surf/80 p-2.5 rounded-xl border border-line/60">
                        <div>
                          <p className="text-xs font-bold text-textLight">{rt.type}</p>
                          <p className="text-[10px] text-muted">
                            {fmt(rt.pricePerNight)} / night &bull; {hotelNights} {hotelNights === 1 ? "night" : "nights"}
                          </p>
                        </div>
                        <div className="text-right flex items-center gap-2">
                          <div>
                            <p className="text-xs font-mono font-extrabold text-accent">{fmt(rt.total)}</p>
                            <p className="text-[9px] text-muted">all taxes incl.</p>
                          </div>
                          <Btn
                            variant="teal"
                            className="py-1 px-3 text-[11px] font-bold"
                            onClick={() =>
                              openBookingModal({
                                type: "hotel",
                                operator: h.name,
                                from: h.city,
                                to: h.location,
                                departDate: checkInDate,
                                arriveDate: checkOutDate,
                                departTime: "12:00 PM Check-in",
                                arriveTime: "11:00 AM Check-out",
                                travelClass: rt.type,
                                amount: rt.total,
                                rateDesc: `${hotelNights} nights × ${fmt(rt.pricePerNight)}`,
                              })
                            }
                          >
                            Reserve
                          </Btn>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ===================== TAB 5: MY BOOKINGS ===================== */}
        {activeTab === "bookings" && (
          <div className="space-y-3 animate-fadeUp">
            <div className="flex items-center justify-between px-1 mb-1">
              <h3 className="text-xs font-bold text-muted uppercase tracking-wider">
                My Stored Bookings ({myBookings.length})
              </h3>
              <button onClick={loadBookings} className="text-xs text-accent font-semibold hover:underline">
                Refresh ↻
              </button>
            </div>

            {loadingBookings ? (
              <div className="py-12 text-center text-muted text-xs">Loading stored travel bookings...</div>
            ) : myBookings.length === 0 ? (
              <Card className="p-8 text-center border-line">
                <p className="text-3xl mb-2">🎟️</p>
                <h4 className="text-sm font-bold text-textLight mb-1">No Stored Bookings Yet</h4>
                <p className="text-xs text-muted mb-4">
                  Whenever you book a train, flight, bus or hotel, all tickets will be safely stored right here with live PDF viewing!
                </p>
                <Btn variant="teal" onClick={() => setActiveTab("train")}>
                  Book a Train Ticket Now
                </Btn>
              </Card>
            ) : (
              myBookings.map((b) => (
                <Card key={b.id} className="p-4 border-line hover:border-accent/40 transition-all">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">
                        {b.booking_type === "train" ? "🚆" : b.booking_type === "flight" ? "✈️" : b.booking_type === "bus" ? "🚌" : "🏨"}
                      </span>
                      <div>
                        <p className="text-xs font-bold text-textLight">{b.operator_name}</p>
                        <p className="text-[10px] font-mono text-accent font-bold">PNR: {b.pnr_or_ticket_no}</p>
                      </div>
                    </div>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-400 font-bold px-2 py-0.5 rounded uppercase">
                      {b.status}
                    </span>
                  </div>

                  <div className="bg-surf/60 rounded-xl p-2.5 my-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-muted uppercase font-bold">Origin</p>
                        <p className="font-bold text-textLight">{b.from_location}</p>
                      </div>
                      <span className="text-muted">&#10230;</span>
                      <div className="text-right">
                        <p className="text-[10px] text-muted uppercase font-bold">Destination</p>
                        <p className="font-bold text-textLight">{b.to_location}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-line/40 text-[11px] text-muted">
                      <span>Date: <strong className="text-textLight">{b.departure_date}</strong></span>
                      <span>Class: <strong className="text-accent">{b.travel_class}</strong></span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <div>
                      <p className="text-[10px] text-muted">Total Paid</p>
                      <p className="text-sm font-mono font-extrabold text-textLight">{fmt(b.amount)}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleViewTicket(b)}
                        className="btn bg-card border border-line hover:border-accent text-textLight px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"
                      >
                        👁 View
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadTicket(b)}
                        className="btn bg-accent text-white shadow-accentGlow hover:brightness-110 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"
                      >
                        ⬇ Download
                      </button>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}
      </div>

      {/* ===================== CHECKOUT & PASSENGER MODAL ===================== */}
      {selectedBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-md bg-card border border-line rounded-3xl shadow-2xl p-5 overflow-hidden max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-accent">Review & Pay</span>
                <h3 className="text-lg font-extrabold text-textLight">Confirm Booking</h3>
              </div>
              <button
                onClick={() => setSelectedBooking(null)}
                className="w-8 h-8 rounded-full bg-surf flex items-center justify-center text-muted hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Trip Details Card */}
            <div className="bg-surf/90 rounded-2xl p-3.5 border border-line mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-textLight">{selectedBooking.operator}</span>
                <span className="text-xs font-mono font-extrabold text-accent">{fmt(selectedBooking.amount)}</span>
              </div>
              <p className="text-[11px] text-muted">
                {selectedBooking.from} ➔ {selectedBooking.to}
              </p>
              <div className="flex items-center justify-between text-[10px] text-muted mt-2 pt-2 border-t border-line/60">
                <span>Date: <strong className="text-textLight">{selectedBooking.departDate}</strong></span>
                <span>Class: <strong className="text-accent">{selectedBooking.travelClass}</strong></span>
              </div>
            </div>

            {/* Passenger Form */}
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-[10px] uppercase font-bold text-muted block mb-1">Passenger / Guest Full Name</label>
                <input
                  type="text"
                  value={passengerName}
                  onChange={(e) => setPassengerName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                  className="w-full bg-surf border border-line rounded-xl px-3 py-2 text-xs text-textLight font-semibold outline-none focus:border-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase font-bold text-muted block mb-1">Age</label>
                  <input
                    type="number"
                    value={passengerAge}
                    onChange={(e) => setPassengerAge(e.target.value)}
                    className="w-full bg-surf border border-line rounded-xl px-3 py-2 text-xs text-textLight font-semibold outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-muted block mb-1">Gender</label>
                  <select
                    value={passengerGender}
                    onChange={(e) => setPassengerGender(e.target.value)}
                    className="w-full bg-surf border border-line rounded-xl px-3 py-2 text-xs text-textLight font-semibold outline-none focus:border-accent"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              {selectedBooking.type === "train" && (
                <div>
                  <label className="text-[10px] uppercase font-bold text-muted block mb-1">Berth Preference</label>
                  <select
                    value={berthPreference}
                    onChange={(e) => setBerthPreference(e.target.value)}
                    className="w-full bg-surf border border-line rounded-xl px-3 py-2 text-xs text-textLight font-semibold outline-none focus:border-accent"
                  >
                    <option value="Lower Berth">Lower Berth</option>
                    <option value="Middle Berth">Middle Berth</option>
                    <option value="Upper Berth">Upper Berth</option>
                    <option value="Side Lower">Side Lower</option>
                    <option value="Side Upper">Side Upper</option>
                    <option value="No Preference">No Preference</option>
                  </select>
                </div>
              )}
            </div>

            {bookingError && <p className="text-danger text-xs font-semibold mb-3">{bookingError}</p>}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <Btn variant="dark" onClick={() => setSelectedBooking(null)} className="flex-1 py-2.5 text-xs font-semibold">
                Cancel
              </Btn>
              <Btn
                variant="teal"
                onClick={() => {
                  if (!passengerName.trim()) {
                    setBookingError("Please enter passenger/guest full name");
                    return;
                  }
                  setBookingError("");
                  setShowPaymentModal(true);
                }}
                className="flex-1 py-2.5 font-bold text-xs flex items-center justify-center gap-1 cursor-pointer"
              >
                Proceed to Pay ({fmt(selectedBooking.amount)}) →
              </Btn>
            </div>
          </div>
        </div>
      )}

      {/* ===================== PAYMENT METHOD MODAL (NORMAL VS ADVANCE PAY) ===================== */}
      <PaymentMethodModal
        isOpen={showPaymentModal && !!selectedBooking}
        onClose={() => setShowPaymentModal(false)}
        title={`${selectedBooking?.operator || "Ticket"} Booking`}
        subtitle={`${selectedBooking?.from} ➔ ${selectedBooking?.to} • ${selectedBooking?.travelClass}`}
        amount={selectedBooking?.amount || 0}
        recipient={selectedBooking?.operator}
        accountBalance={profile?.account?.balance ?? 0}
        onAddMoney={() => {
          setShowPaymentModal(false);
          setSelectedBooking(null);
          onNavigate?.("addmoney");
        }}
        onConfirm={async (enteredPin, mode) => {
          await handleConfirmBooking(enteredPin, mode);
        }}
        loading={submitting}
        error={bookingError}
      />

      {/* ===================== CONFIRMED TICKET SUCCESS MODAL ===================== */}
      {confirmedBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-md bg-card border border-line rounded-3xl shadow-2xl p-5 text-center overflow-hidden animate-heartbeat">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center text-3xl mx-auto mb-3">
              ✓
            </div>
            <h2 className="text-xl font-extrabold text-emerald-400">Booking Confirmed!</h2>
            <p className="text-xs text-muted mt-1">
              Your ticket has been saved to <strong>My Bookings</strong> at the top!
            </p>

            <div className="bg-surf/90 rounded-2xl p-4 border border-line my-4 text-left">
              <div className="flex justify-between items-center mb-2 pb-2 border-b border-line">
                <span className="text-[10px] uppercase font-bold text-muted">Booking Reference</span>
                <span className="text-xs font-mono font-extrabold text-accent">{confirmedBooking.pnr_or_ticket_no}</span>
              </div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-muted">Operator</span>
                <span className="text-xs font-bold text-textLight">{confirmedBooking.operator_name}</span>
              </div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-muted">Route</span>
                <span className="text-xs font-semibold text-textLight">{confirmedBooking.from_location} ➔ {confirmedBooking.to_location}</span>
              </div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-muted">Date & Class</span>
                <span className="text-xs font-semibold text-textLight">{confirmedBooking.departure_date} &bull; {confirmedBooking.travel_class}</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-line mt-2">
                <span className="text-xs font-bold text-muted">Amount Paid</span>
                <span className="text-sm font-mono font-extrabold text-emerald-400">{fmt(confirmedBooking.amount)}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleViewTicket(confirmedBooking)}
                  className="btn flex-1 bg-surf border border-line hover:border-accent text-textLight py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  👁 View Ticket (PDF)
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadTicket(confirmedBooking)}
                  className="btn flex-1 bg-accent text-white shadow-accentGlow hover:brightness-110 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  ⬇ Download (PDF)
                </button>
              </div>

              <div className="flex gap-2 mt-1">
                <Btn
                  variant="dark"
                  onClick={() => {
                    setConfirmedBooking(null);
                    setActiveTab("train");
                  }}
                  className="flex-1 py-2 text-xs font-semibold"
                >
                  🔄 Book Another Ticket
                </Btn>
                <Btn
                  variant="teal"
                  onClick={() => {
                    setConfirmedBooking(null);
                    setActiveTab("bookings");
                  }}
                  className="flex-1 py-2 text-xs font-bold"
                >
                  🎟️ Go to My Bookings
                </Btn>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================== PDF PREVIEW MODAL ===================== */}
      <PdfPreviewModal
        isOpen={previewModalOpen}
        onClose={() => setPreviewModalOpen(false)}
        pdfBlob={previewBlob}
        title={previewTitle}
        filename={previewFilename}
        loading={loadingPdf}
      />
    </div>
  );
}
