"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type FormEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowRight,
  ArrowUp,
  Bot,
  CheckCircle2,
  Clock3,
  Compass,
  Globe2,
  Hotel,
  LoaderCircle,
  MapPin,
  Menu,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plane,
  Plus,
  Sparkles,
  Wallet,
  X,
  XCircle,
  Trash2,
  Globe,
  BotIcon,
  CircleDollarSignIcon,
  Clock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Trip = {
  id: string;
  title: string;
  prompt: string;
  answer: string;
  threadId?: string;
  flightResults?: string;
  hotelResults?: string;
  itinerary?: string;
  llmCalls?: number;
  updatedAt: number;
};

type Suggestion = {
  title: string;
  description: string;
  prompt: string;
  icon: LucideIcon;
};

const HISTORY_KEY = "tripsync-trip-history";

const suggestions: Suggestion[] = [
  {
    title: "Beach escape",
    description: "Sunshine, coastal stays, and local food.",
    prompt:
      "Plan a 5-day beach holiday in Bali from Kathmandu for two people, including flights, hotels, beaches, and local food.",
    icon: Globe2,
  },
  {
    title: "Mountain adventure",
    description: "Discover scenic trails and mountain towns.",
    prompt:
      "Plan a 6-day mountain adventure from Bhutan to Nepal with scenic hikes, comfortable accommodation, and an estimated budget.",
    icon: Compass,
  },
  {
    title: "City discovery",
    description: "Explore culture, food, and hidden gems.",
    prompt:
      "Plan a 4-day trip to Bangkok from California with flights, centrally located hotels, local food, cultural attractions, and a daily itinerary.",
    icon: MapPin,
  },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function makeTripTitle(prompt: string) {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  return cleaned.length > 48
    ? `${cleaned.slice(0, 48).trim()}…`
    : cleaned || "New trip";
}

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred. Please try again.";
}

function validateTripPrompt(prompt: string): string | null {
  const cleaned = prompt.trim();
  const words = cleaned.split(/\s+/).filter(Boolean);

  if (!cleaned) {
    return "Please describe the trip you want to plan.";
  }

  if (cleaned.length < 12 || words.length < 3) {
    return "Please provide a more detailed request, including a destination or travel plan.";
  }

  // Reject inputs that contain no meaningful letters.
  if (!/[a-zA-Z]{2,}/.test(cleaned)) {
    return "Please enter a meaningful travel request.";
  }

  // Reject repeated characters such as "aaaaaaaa".
  if (/^(.)\1+$/.test(cleaned.replace(/\s/g, ""))) {
    return "Please describe your travel plans in a few words.";
  }

  // Require some indication of travel intent.
  const travelKeywords =
    /\b(trip|travel|visit|vacation|holiday|itinerary|destination|flight|flights|hotel|hotels|tour|explore|sightseeing|adventure|beach|mountain|days?|nights?|budget|departing|departure|from|to|stay|traveling|travelling|backpacking|road trip)\b/i;

  if (!travelKeywords.test(cleaned)) {
    return "Please describe a travel-related request, such as a destination, trip, flight, or itinerary.";
  }

  return null;
}

function getApiErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    error?: unknown;
    detail?: unknown;
  };

  if (typeof payload.error === "string") {
    return payload.error;
  }

  if (typeof payload.detail === "string") {
    return payload.detail;
  }

  return null;
}

function getRetryAfterSeconds(response: Response): number {
  const retryAfter = response.headers.get("Retry-After");
  const seconds = retryAfter ? Number(retryAfter) : NaN;

  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.ceil(seconds);
  }

  // Fallback for a rate-limit response without Retry-After.
  return 60;
}

function isDailyLimitError(message: string): boolean {
  return /daily limit reached/i.test(message);
}

export default function Home() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [history, setHistory] = useState<Trip[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | undefined>();

  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");
  const [llmCalls, setLlmCalls] = useState<number | undefined>();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const [tripToDelete, setTripToDelete] = useState<string | null>(null);
  const [dailyLimitReached, setDailyLimitReached] = useState(false);

  const hasResults = Boolean(answer || loading || error || activeTripId);

  const submissionInProgress = useRef(false);

  // Restore saved trips once on the client.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setHistory(parsed as Trip[]);
        }
      }
    } catch {
      // Ignore invalid or inaccessible local storage.
    } finally {
      setHistoryReady(true);
    }
  }, []);

  // Update cooldown timer every second.
  useEffect(() => {
    if (cooldownSeconds <= 0) return;

    const timer = window.setInterval(() => {
      setCooldownSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  // Clear the daily-limit UI lock at the next UTC midnight.
  useEffect(() => {
    if (!dailyLimitReached) return;

    const now = new Date();

    const nextUtcMidnight = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
    );

    const timeout = window.setTimeout(
      () => {
        setDailyLimitReached(false);
      },
      Math.max(0, nextUtcMidnight - now.getTime()),
    );

    return () => window.clearTimeout(timeout);
  }, [dailyLimitReached]);

  // Persist history without overwriting storage before restoration.
  useEffect(() => {
    if (!historyReady) return;

    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      // The app remains usable if browser storage is unavailable.
    }
  }, [history, historyReady]);

  const resetTrip = useCallback(() => {
    setPrompt("");
    setAnswer("");
    setLlmCalls(undefined);
    setThreadId(undefined);
    setActiveTripId(null);
    setError("");
    setLoading(false);
    setMobileSidebarOpen(false);
  }, []);

  const openHistory = useCallback((trip: Trip) => {
    setActiveTripId(trip.id);
    setThreadId(trip.threadId);
    setPrompt(trip.prompt);
    setAnswer(trip.answer);
    setLlmCalls(trip.llmCalls);
    setError("");
    setLoading(false);
    setMobileSidebarOpen(false);
  }, []);

  const handleDeleteTrip = useCallback(
    (tripId: string) => {
      setHistory((previous) => previous.filter((trip) => trip.id !== tripId));

      // If the deleted trip is currently open, return to the home screen.
      if (activeTripId === tripId) {
        resetTrip();
      }

      setTripToDelete(null);
    },
    [activeTripId, resetTrip],
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      submissionInProgress.current ||
      loading ||
      cooldownSeconds > 0 ||
      dailyLimitReached
    ) {
      return;
    }

    const message = prompt.trim();
    const validationError = validateTripPrompt(message);

    if (validationError) {
      setError(validationError);
      return;
    }

    submissionInProgress.current = true;
    setLoading(true);
    setError("");
    setAnswer("");
    setLlmCalls(undefined);

    // Start a local cooldown when a request is actually sent.
    // The backend remains authoritative for rate limiting.
    setCooldownSeconds(60);

    try {
      const response = await fetch(`${API_URL}/api/plan_trip`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          ...(threadId ? { thread_id: threadId } : {}),
        }),
      });

      const data: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const apiError = getApiErrorMessage(data);

        if (response.status === 429) {
          const errorMessage =
            apiError ??
            "Your request was rate-limited. Please try again later.";

          if (isDailyLimitError(errorMessage)) {
            setDailyLimitReached(true);
            setCooldownSeconds(0);
            setError(errorMessage);
          } else {
            // Prefer the backend's retry hint when available.
            setCooldownSeconds(getRetryAfterSeconds(response));
            setError(
              "You're planning trips too quickly. Please wait before trying again.",
            );
          }

          return;
        }

        setError(
          apiError ??
            `The server returned an error (${response.status}). Please try again.`,
        );
        return;
      }

      if (!data || typeof data !== "object" || !("success" in data)) {
        throw new Error("The backend returned an invalid response.");
      }

      const result = data as {
        success: boolean;
        error?: string;
        thread_id?: string;
        answer?: unknown;
        flight_results?: unknown;
        hotel_results?: unknown;
        itinerary?: unknown;
        llm_calls?: number;
      };

      if (result.success === false) {
        throw new Error(
          result.error || "The trip planner could not complete your request.",
        );
      }

      const newThreadId = result.thread_id || threadId;
      const newAnswer = toText(result.answer);

      const newFlightResults = toText(result.flight_results);
      const newHotelResults = toText(result.hotel_results);
      const newItinerary = toText(result.itinerary);

      const newLlmCalls =
        typeof result.llm_calls === "number" ? result.llm_calls : undefined;

      if (!newAnswer.trim()) {
        throw new Error("The backend returned an empty itinerary.");
      }

      const id = activeTripId || crypto.randomUUID();

      const savedTrip: Trip = {
        id,
        title: makeTripTitle(message),
        prompt: message,
        answer: newAnswer,
        threadId: newThreadId,
        flightResults: newFlightResults,
        hotelResults: newHotelResults,
        itinerary: newItinerary,
        llmCalls: newLlmCalls,
        updatedAt: Date.now(),
      };

      setThreadId(newThreadId);
      setActiveTripId(id);
      setAnswer(newAnswer);
      setLlmCalls(newLlmCalls);

      setHistory((previous) => [
        savedTrip,
        ...previous.filter((trip) => trip.id !== id),
      ]);
    } catch (err) {
      setError(
        `${getErrorMessage(err)} Check that your FastAPI backend is running and NEXT_PUBLIC_API_URL is correct.`,
      );
    } finally {
      setLoading(false);

      // Critical: permit another request after completion and cooldown.
      submissionInProgress.current = false;
    }
  };

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const SidebarContent = ({ mobile = false }: { mobile?: boolean }) => {
    const collapsed = sidebarCollapsed && !mobile;

    return (
      <>
        {/* Brand */}
        <button
          onClick={resetTrip}
          title={collapsed ? "TripSync home" : undefined}
          aria-label="TripSync home"
          className={`mb-8 flex w-full shrink-0 items-center gap-3 text-left ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#183d31] text-white shadow-lg shadow-emerald-950/10">
            <Compass size={23} />
          </span>

          {!collapsed && (
            <span className="min-w-0">
              <span className="block text-lg font-bold text-[#1d3028]">
                TripSync
              </span>
              <span className="block whitespace-nowrap text-[10px] font-medium tracking-[0.12em] text-[#849187]">
                Multi-Agent AI Trip Planner
              </span>
            </span>
          )}
        </button>

        {/* New trip */}
        <button
          onClick={resetTrip}
          title={collapsed ? "Plan a new trip" : undefined}
          className={`flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-[#183d31] px-3 py-3.5 text-sm font-semibold text-white shadow-md shadow-emerald-950/10 transition hover:bg-[#245442] ${
            collapsed ? "" : "justify-start px-4"
          }`}
        >
          <Plus size={18} className="shrink-0" />
          {dailyLimitReached ? (
            <span>Daily limit reached</span>
          ) : (
            <span>Plan a new trip</span>
          )}
        </button>

        {/* Recent trips */}
        {!collapsed && (
          <div className="mt-8 flex min-h-0 flex-1 flex-col">
            <div className="mb-3 flex shrink-0 items-center justify-between px-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#96a197]">
                Recent trips
              </p>
              <span className="text-xs text-[#9ba59c]">{history.length}</span>
            </div>

            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain">
              {history.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#e1e6de] px-3 py-5 text-center">
                  <Clock3 className="mx-auto mb-2 text-[#a5b0a6]" size={20} />
                  <p className="text-xs leading-5 text-[#879187]">
                    Your planned trips will appear here.
                  </p>
                </div>
              ) : (
                history.map((trip) => (
                  <div
                    key={trip.id}
                    className={`group flex items-center gap-1 rounded-xl transition ${
                      activeTripId === trip.id
                        ? "bg-[#eef4ec] text-[#234b39]"
                        : "text-[#788379] hover:bg-[#f7f8f4] hover:text-[#234b39]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => openHistory(trip)}
                      aria-label={`Open trip: ${trip.title}`}
                      className="flex min-w-0 flex-1 items-start gap-3 rounded-xl px-3 py-3 text-left"
                    >
                      <span className="line-clamp-2 min-w-0 flex-1 text-xs leading-5">
                        {trip.title}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTripToDelete(trip.id)}
                      disabled={loading}
                      title={`Delete ${trip.title}`}
                      aria-label={`Delete trip: ${trip.title}`}
                      className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#9aa39a] transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-30 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Sidebar footer */}
        {!collapsed && (
          <div className="mt-6 shrink-0 rounded-2xl bg-[#f3f5ee] p-4">
            <div className="mb-2 flex items-center gap-2 text-[#45634d]">
              <Globe size={16} />
              <span className="text-xs font-bold">Travel smarter</span>
            </div>
            <p className="text-xs leading-5 text-[#7c897b]">
              Tell us your destination, dates, travel style, and budget to get a
              more useful plan.
            </p>
          </div>
        )}
      </>
    );
  };

  return (
    <main className="h-dvh overflow-hidden bg-[#f7f8f4] text-[#1d3028] selection:bg-emerald-200">
      <div className="flex h-full min-h-0">
        {/* Desktop sidebar*/}
        <aside
          className={`relative z-30 hidden h-full shrink-0 flex-col overflow-hidden border-r border-[#e6e9e1] bg-white px-3 py-6 transition-[width] duration-300 ease-in-out lg:flex xl:px-4 xl:py-7 ${
            sidebarCollapsed ? "w-[76px]" : "w-[250px] xl:w-[270px]"
          }`}
        >
          <SidebarContent />
        </aside>

        {/* drawer */}
        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              aria-label="Close navigation"
              onClick={() => setMobileSidebarOpen(false)}
              className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
            />

            <aside className="absolute inset-y-0 left-0 flex w-[min(300px,85vw)] flex-col overflow-hidden border-r border-[#e6e9e1] bg-white px-5 py-6 shadow-2xl animate-in slide-in-from-left duration-200">
              <div className="mb-4 flex items-center justify-end">
                <button
                  onClick={() => setMobileSidebarOpen(false)}
                  aria-label="Close navigation"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-[#718174] hover:bg-[#f1f5ef]"
                >
                  <X size={20} />
                </button>
              </div>
              <SidebarContent mobile />
            </aside>
          </div>
        )}

        {/* Main content */}
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Sticky header */}
          <header className="relative z-20 flex h-[64px] shrink-0 items-center justify-between gap-3 border-b border-[#e6e9e1]/90 bg-[#f7f8f4]/95 px-4 backdrop-blur-xl sm:h-[68px] sm:px-6 lg:h-[72px] lg:px-8 xl:px-10">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              {/* Mobile/tablet drawer toggle */}
              <button
                onClick={() => setMobileSidebarOpen(true)}
                aria-label="Open navigation"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#718174] transition hover:bg-[#eaf0e7] hover:text-[#183d31] lg:hidden"
              >
                <Menu size={21} />
              </button>

              {/* Desktop collapse toggle */}
              <button
                onClick={() => setSidebarCollapsed((previous) => !previous)}
                aria-label={
                  sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
                }
                title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#718174] transition hover:bg-[#eaf0e7] hover:text-[#183d31] lg:flex"
              >
                {sidebarCollapsed ? (
                  <PanelLeftOpen size={19} />
                ) : (
                  <PanelLeftClose size={19} />
                )}
              </button>

              {/* Mobile brand */}
              <button
                onClick={resetTrip}
                className="flex min-w-0 items-center gap-2 lg:hidden"
                aria-label="TripSync home"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#183d31] text-white">
                  <Compass size={18} />
                </span>
                <span className="truncate font-bold tracking-tight">
                  TripSync
                </span>
              </button>
            </div>

            <div className="flex shrink-0 items-center gap-2 rounded-full border border-[#e3e8df] bg-white px-2.5 py-2 text-[10px] font-medium text-[#6e7e70] sm:px-3 sm:text-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span>Multi-Agent AI Travel Assistant</span>
            </div>
          </header>

          {/* Main content scroll container */}
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain"
            style={{ scrollbarGutter: "stable" }}
          >
            <div className="mx-auto w-full max-w-5xl px-4 pb-10 pt-6 sm:px-6 sm:pb-14 sm:pt-9 lg:px-10 lg:pt-11 xl:px-12">
              {!hasResults ? (
                <>
                  {/* Hero */}
                  <section className="relative isolate overflow-hidden rounded-[24px] bg-[#183d31] px-5 py-8 text-white shadow-xl shadow-emerald-950/5 sm:rounded-[30px] sm:px-8 sm:py-10 md:px-10 lg:px-12 lg:py-12">
                    <div className="pointer-events-none absolute -right-16 -top-24 -z-10 h-72 w-72 rounded-full border border-white/10" />
                    <div className="pointer-events-none absolute -right-4 -top-12 -z-10 h-52 w-52 rounded-full border border-white/10" />
                    <div className="pointer-events-none absolute -bottom-24 right-12 -z-10 h-48 w-48 rounded-full bg-emerald-400/10 blur-3xl sm:right-24" />

                    <div className="relative z-10 max-w-2xl">
                      <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-emerald-100 sm:mb-6">
                        <BotIcon size={14} />
                        Your personal AI trip planner
                      </div>

                      <h1 className="max-w-xl text-[34px] font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-[58px]">
                        The world is big.
                        <br />
                        <span className="font-serif italic text-[#c7dfb8]">
                          Your plans can be simple.
                        </span>
                      </h1>

                      <p className="mt-5 max-w-lg text-sm leading-7 text-[#d0dfd4] sm:text-base">
                        From flight research to places worth staying, turn your
                        travel ideas into a thoughtful, personalized itinerary.
                      </p>

                      <div className="mt-7 flex flex-wrap gap-x-5 gap-y-3 text-xs text-[#d6e3d8] sm:mt-8">
                        <span className="flex items-center gap-2">
                          <Plane size={15} /> Flight research
                        </span>
                        <span className="flex items-center gap-2">
                          <Hotel size={15} /> Hotel discovery
                        </span>
                        <span className="flex items-center gap-2">
                          <CircleDollarSignIcon size={15} /> Budget planning
                        </span>
                        <span className="flex items-center gap-2">
                          <Clock size={15} /> Day-by-day plans
                        </span>
                      </div>
                    </div>
                  </section>

                  {/* Initial prompt form */}
                  <section className="mt-8 sm:mt-9">
                    <div className="mb-4">
                      <h2 className="text-lg font-bold tracking-tight sm:text-xl">
                        Where would you like to go?
                      </h2>
                      <p className="mt-1 text-sm text-[#879187]">
                        Start with an idea. We&apos;ll help with the details.
                      </p>
                    </div>

                    <form
                      onSubmit={handleSubmit}
                      className="rounded-[22px] border border-[#e1e7dd] bg-white p-2.5 shadow-sm transition focus-within:border-[#91b39a] focus-within:shadow-lg focus-within:shadow-emerald-950/[0.04] sm:rounded-[24px] sm:p-4"
                    >
                      <textarea
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        onKeyDown={handlePromptKeyDown}
                        rows={3}
                        placeholder="e.g. Plan a 6-day trip to Bali for two people, departing from Kathmandu, with a mix of beaches and local food..."
                        className="w-full resize-y border-0 bg-transparent px-2 py-3 text-sm leading-7 text-[#263a2e] outline-none placeholder:text-[#a4ada4] focus:ring-0 sm:px-3 sm:text-base"
                        aria-label="Describe your trip"
                      />

                      <div className="flex flex-col gap-3 border-t border-[#edf0e9] px-2 pt-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-[#9aa39a]">
                          <span className="hidden sm:inline">
                            Be specific about budget, dates, and travel style.
                          </span>
                          <span className="sm:hidden">
                            Shift + Enter for a new line.
                          </span>
                        </p>

                        <button
                          type="submit"
                          disabled={
                            !prompt.trim() ||
                            loading ||
                            cooldownSeconds > 0 ||
                            dailyLimitReached
                          }
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#183d31] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#245442] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
                        >
                          {loading ? (
                            <LoaderCircle size={16} className="animate-spin" />
                          ) : (
                            <ArrowUp size={16} />
                          )}

                          {dailyLimitReached
                            ? "Daily limit reached"
                            : loading
                              ? "Planning your trip..."
                              : cooldownSeconds > 0
                                ? `Try again in ${cooldownSeconds}s`
                                : "Plan my trip"}
                        </button>
                      </div>
                    </form>

                    {error && (
                      <ErrorMessage
                        error={error}
                        variant={dailyLimitReached ? "warning" : "error"}
                      />
                    )}
                  </section>

                  {/* Suggestions */}
                  <section className="mt-9 sm:mt-10">
                    <div className="mb-4 flex items-center gap-2">
                      <Sparkles size={16} className="text-[#6d9973]" />
                      <h2 className="text-sm font-bold">
                        Need a little inspiration?
                      </h2>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {suggestions.map((suggestion) => {
                        const Icon = suggestion.icon;

                        return (
                          <button
                            key={suggestion.title}
                            onClick={() => {
                              setPrompt(suggestion.prompt);
                              window.scrollTo?.({ top: 0, behavior: "smooth" });
                            }}
                            className="group rounded-2xl border border-[#e5e9e1] bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-[#b8cdb6] hover:shadow-lg hover:shadow-emerald-950/[0.04]"
                          >
                            <span className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-[#eef4eb] text-[#4b7655] transition group-hover:bg-[#183d31] group-hover:text-white">
                              <Icon size={19} />
                            </span>
                            <span className="block text-sm font-bold">
                              {suggestion.title}
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-[#899489]">
                              {suggestion.description}
                            </span>
                            <span className="mt-4 flex items-center gap-1 text-xs font-semibold text-[#4f7757]">
                              Use this idea
                              <ArrowRight
                                size={14}
                                className="transition group-hover:translate-x-1"
                              />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <div className="mt-9 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 text-xs text-[#a0a99f] sm:mt-10 sm:gap-x-6">
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 size={14} />
                      Personalized itineraries
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Wallet size={14} />
                      Budget-aware planning
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Globe2 size={14} />
                      Explore with confidence
                    </span>
                  </div>
                </>
              ) : (
                <>
                  {/* Results heading */}
                  <div className="mb-6 flex flex-col justify-between gap-4 sm:mb-7 sm:flex-row sm:items-start">
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-[#66866a]">
                        <Sparkles size={14} />
                        Your travel plan
                      </div>
                      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                        Let&apos;s make it happen.
                      </h1>
                      <p className="mt-2 max-w-xl text-sm leading-6 text-[#859084]">
                        Your request and research results, all in one place.
                      </p>
                    </div>

                    <button
                      onClick={resetTrip}
                      className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-[#dfe6db] bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-[#f0f4ec] sm:w-auto"
                    >
                      <Plus size={16} />
                      New trip
                    </button>
                  </div>

                  {/* Loading */}
                  {loading && (
                    <div className="mb-6 rounded-3xl border border-[#e3e9df] bg-white p-5 sm:mb-7 sm:p-8">
                      <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#eaf2e7] text-[#315c42]">
                          <LoaderCircle size={24} className="animate-spin" />
                        </div>
                        <div>
                          <h2 className="font-bold">Crafting your itinerary</h2>
                          <p className="mt-1 text-sm leading-6 text-[#879187]">
                            Searching your request. This can take a little
                            while.
                          </p>
                        </div>
                      </div>
                      <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-[#edf1e9]">
                        <div className="h-full w-1/2 animate-pulse rounded-full bg-[#588260]" />
                      </div>
                      <p className="mt-3 text-xs text-[#9aa39a]">
                        Your plan will appear when the backend finishes
                        processing.
                      </p>
                    </div>
                  )}

                  {/* Original request */}
                  <div className="mb-5 rounded-2xl border border-[#e1e7dd] bg-white p-4 sm:mb-6 sm:p-6">
                    <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#849084]">
                      <MessageCircle size={15} />
                      Your request
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm leading-7 text-[#34473a]">
                      {prompt}
                    </p>
                    <button
                      onClick={() => {
                        setAnswer("");
                        setError("");
                      }}
                      className="mt-4 text-xs font-semibold text-[#55795a] hover:text-[#183d31]"
                    >
                      Ask for a different trip
                    </button>
                  </div>

                  {error && <ErrorMessage error={error} />}

                  {/* Answer */}
                  {answer && (
                    <div className="overflow-hidden rounded-3xl border border-[#e1e7dd] bg-white shadow-sm">
                      <div className="flex flex-col justify-between gap-3 border-b border-[#edf0e9] px-4 py-4 sm:flex-row sm:items-center sm:px-7">
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#183d31] text-white">
                            <Bot size={20} />
                          </span>
                          <div>
                            <h2 className="font-bold">
                              Your personalized plan
                            </h2>
                            <p className="mt-0.5 text-xs text-[#8b978a]">
                              Generated by your trip-planning agents
                            </p>
                          </div>
                        </div>
                      </div>

                      <article className="markdown-content min-w-0 overflow-x-auto px-4 py-5 text-sm leading-7 sm:px-7 sm:py-8">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ ...props }) => (
                              <a
                                {...props}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="break-words text-[#38734c] underline underline-offset-2 hover:text-[#183d31]"
                              />
                            ),
                            table: ({ ...props }) => (
                              <div className="my-4 w-full overflow-x-auto rounded-xl border border-[#e5e9e1]">
                                <table
                                  {...props}
                                  className="w-full min-w-[480px] border-collapse text-left text-sm"
                                />
                              </div>
                            ),
                            th: ({ ...props }) => (
                              <th
                                {...props}
                                className="border-b border-[#e5e9e1] bg-[#f3f6f0] px-3 py-2 font-semibold"
                              />
                            ),
                            td: ({ ...props }) => (
                              <td
                                {...props}
                                className="border-b border-[#edf0e9] px-3 py-2 align-top"
                              />
                            ),
                            pre: ({ ...props }) => (
                              <pre
                                {...props}
                                className="max-w-full overflow-x-auto rounded-xl bg-[#f3f5ef] p-4 text-xs leading-6"
                              />
                            ),
                          }}
                        >
                          {answer}
                        </ReactMarkdown>
                      </article>

                      {typeof llmCalls === "number" && (
                        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#edf0e9] px-4 py-3 text-xs text-[#8c988c] sm:px-7">
                          <span className="flex items-center gap-2">
                            <CheckCircle2
                              size={14}
                              className="text-emerald-600"
                            />
                            Planning completed
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {!loading && !answer && !error && (
                    <div className="rounded-2xl border border-[#e1e7dd] bg-white p-5 text-sm leading-6 text-[#879187]">
                      Enter your trip details below to get started.
                    </div>
                  )}

                  {/* Follow-up prompt */}
                  <form
                    onSubmit={handleSubmit}
                    className="mt-5 rounded-2xl border border-[#e1e7dd] bg-white p-3 shadow-sm transition focus-within:border-[#91b39a] sm:mt-6 sm:p-4"
                  >
                    <textarea
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      onKeyDown={handlePromptKeyDown}
                      rows={2}
                      placeholder="Refine your trip... e.g. reduce the budget or add more outdoor activities."
                      className="w-full resize-y border-0 bg-transparent px-2 py-2 text-sm leading-6 outline-none placeholder:text-[#a4ada4] focus:ring-0"
                      aria-label="Refine your trip request"
                    />
                    <div className="flex flex-col gap-3 border-t border-[#edf0e9] pt-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="hidden text-xs text-[#9aa39a] sm:block">
                        Shift + Enter for a new line
                      </p>

                      <button
                        type="submit"
                        disabled={
                          !prompt.trim() ||
                          loading ||
                          cooldownSeconds > 0 ||
                          dailyLimitReached
                        }
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#183d31] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#245442] disabled:cursor-not-allowed disabled:opacity-40 sm:ml-auto sm:w-auto"
                      >
                        {loading ? (
                          <LoaderCircle size={16} className="animate-spin" />
                        ) : (
                          <ArrowUp size={16} />
                        )}

                        {dailyLimitReached
                          ? "Daily limit reached"
                          : loading
                            ? "Planning your trip..."
                            : cooldownSeconds > 0
                              ? `Try again in ${cooldownSeconds}s`
                              : "Plan my trip"}
                      </button>
                    </div>
                  </form>

                  <p className="mt-5 text-center text-xs leading-5 text-[#9aa39a]">
                    Verify flight availability, hotel prices, visa requirements,
                    and booking details before making reservations.
                  </p>
                </>
              )}
            </div>
          </div>
        </section>
        {/* Delete trip confirmation modal */}
        {tripToDelete !== null && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center
      bg-black/40 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setTripToDelete(null);
              }
            }}
          >
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-trip-title"
              aria-describedby="delete-trip-description"
              className="w-full max-w-md rounded-2xl border border-[#e5e9e1]
        bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
            >
              <h2
                id="delete-trip-title"
                className="text-lg font-bold tracking-tight text-[#1d3028]"
              >
                <span className="mr-3 inline-flex h-6 w-6 items-center justify-center rounded-lg bg-red-100 text-red-600">
                  <Trash2 size={16} />
                </span>
                Delete this trip?
              </h2>

              <p
                id="delete-trip-description"
                className="mt-2 text-sm leading-6 text-[#788379]"
              >
                Are you sure you want to delete this trip ? This action cannot
                be undone.
              </p>

              <div
                className="mt-7 flex flex-col-reverse gap-3 sm:flex-row
        sm:justify-end"
              >
                <button
                  type="button"
                  onClick={() => setTripToDelete(null)}
                  className="rounded-xl border border-[#dfe6db] bg-white
            px-4 py-2.5 text-sm font-semibold text-[#526354]
            transition hover:bg-[#f5f7f2]"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleDeleteTrip(tripToDelete)}
                  className="inline-flex items-center justify-center gap-2
            rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold
            text-white transition hover:bg-red-700
            disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 size={15} />
                  Delete trip
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function ErrorMessage({
  error,
  variant = "error",
}: {
  error: string;
  variant?: "error" | "warning";
}) {
  const isWarning = variant === "warning";

  return (
    <div
      role="alert"
      className={`mt-4 flex items-start gap-3 rounded-2xl border p-4 text-sm ${
        isWarning
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-red-200 bg-red-50 text-red-800"
      }`}
    >
      <XCircle size={19} className="mt-0.5 shrink-0" />

      <div className="min-w-0">
        <p className="font-semibold">
          {isWarning
            ? "Daily planning quota exhausted"
            : "We couldn't complete your trip."}
        </p>

        <p className="mt-1 break-words leading-6">{error}</p>
      </div>
    </div>
  );
}
