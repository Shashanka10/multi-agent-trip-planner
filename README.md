# TripSync — Multi-Agent AI Trip Planner

TripSync is an AI-powered travel planning application that helps users research flights, discover hotels, and generate personalized, day-by-day travel itineraries. Built with Next.js, FastAPI, and LangGraph, it combines AI-powered planning with external travel research to make trip planning more organized and convenient.

## ✨ Features

- 🤖 **AI-Powered Trip Planning** — Generate personalized itineraries from natural-language prompts.
- ✈️ **Flight Research** — Retrieve and summarize flight-status information for relevant routes.
- 🏨 **Hotel Discovery** — Search for accommodation options based on travel requirements.
- 🧠 **Multi-Agent Workflow** — Orchestrate research and itinerary generation using LangGraph.
- 💬 **Persistent Conversations** — Continue trip-planning conversations using PostgreSQL-backed checkpoints.
- 🕘 **Trip History** — Access previously planned trips from the recent trips panel.
- 📄 **PDF Export** — Download itineraries for offline reference.
- 🛡️ **Rate Limiting** — Help control repeated API requests.

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| Next.js | Frontend application |
| React | User interface |
| Tailwind CSS | Styling |
| FastAPI | Backend API |
| Python | Backend development |
| LangGraph | Multi-agent workflow orchestration |
| Groq API | Language model inference |
| Tavily Search | Web research for travel information |
| AviationStack | Flight-status information |
| PostgreSQL | Conversation checkpoint persistence |
| Browser localStorage | Local trip history |

## ⚙️ How It Works

1. The user enters a trip-planning request.
2. The frontend sends the request to the FastAPI backend.
3. The LangGraph workflow coordinates travel research and itinerary generation.
4. External services provide relevant flight and accommodation information.
5. The AI generates a structured, day-by-day itinerary.
6. The user can refine the plan, revisit recent trips, or export the itinerary as a PDF.

## 📁 Project Structure

```text
TripSync/
├── frontend/          # Next.js application
├── backend/           # FastAPI backend and LangGraph workflow
└── README.md
```

## 🚀 Getting Started

### Prerequisites

- Node.js
- Python
- PostgreSQL
- API keys for the external services used by the backend

### 1. Clone the Repository

```bash
git clone https://github.com/Shashanka10/multi-agent-trip-planner.git
cd TripSync
```

### 2. Set Up the Backend

```bash
cd backend
uv venv
```

Activate the virtual environment.

**Windows:**

```powershell
.venv\Scripts\activate
```

**macOS/Linux:**

```bash
source .venv/bin/activate
```

Install the backend dependencies:

```bash
uv add -r requirements.txt
```

Configure the required environment variables and PostgreSQL connection, then start the FastAPI server. For example, if your application entry point is `main.py`:

```bash
uvicorn main:app --reload
```

Adjust the command if your entry-point module or application variable has a different name.

### 3. Configure Environment Variables

Create a backend environment file and add the API credentials required by your implementation.

```env
GROQ_API_KEY=your_groq_api_key
TAVILY_API_KEY=your_tavily_api_key
AVIATIONSTACK_API_KEY=your_aviationstack_api_key
DATABASE_URL=your_postgresql_connection_string
DEFAULT_ORIGIN_IATA="KTM"
LANGSMITH_TRACING="true"
LANGSMITH_ENDPOINT="https://api.smith.langchain.com"
LANGSMITH_API_KEY=your_langsmith_api_key
LANGSMITH_PROJECT=your-project-name
```

Use the exact variable names expected by your backend code.

### 4. Set Up the Frontend

Open a new terminal:

```bash
cd frontend
pnpm install
```

Create a `.env` file in the frontend directory:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Start the development server:

```bash
pnpm dev
```

Alternatively, use `npm install` and `npm run dev` if your project uses npm.

Open [http://localhost:3000](http://localhost:3000) in your browser.

## 📖 Usage

1. Open TripSync in your browser.
2. Describe your destination, travel dates or duration, preferences, and budget.
3. Review the generated itinerary and travel research.
4. Continue the conversation to refine your plan.
5. Revisit saved trips or download your itinerary as a PDF.

## ⚠️ Notes

- Valid API credentials are required for external travel research and flight data.
- PostgreSQL must be configured for persistent conversation checkpoints.
- Recent trip history stored in `localStorage` is specific to the browser and device.
- Flight-status data does not necessarily include ticket prices or booking availability.
- Always verify flight schedules, accommodation details, prices, and travel requirements with official providers.
