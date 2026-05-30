.PHONY: start stop logs clean

# Start both the backend and frontend in the background
start:
	@echo "Starting Backend (FastAPI)..."
	@cd src/backend && nohup uvicorn main:app --host 127.0.0.1 --port 8000 --reload > ../../backend.log 2>&1 & echo $$! > backend.pid
	@echo "Starting Frontend (Next.js)..."
	@cd src/frontend && nohup npm run dev > ../../frontend.log 2>&1 & echo $$! > frontend.pid
	@echo "========================================="
	@echo "✅ Anchor is running in the background!"
	@echo "Frontend: http://localhost:3000"
	@echo "Backend : http://127.0.0.1:8000"
	@echo "To view logs, run: make logs"
	@echo "To stop, run:      make stop"
	@echo "========================================="

# Stop the background processes
stop:
	@echo "Stopping Backend..."
	@-if [ -f backend.pid ]; then kill `cat backend.pid` 2>/dev/null || true; rm -f backend.pid; fi
	@echo "Stopping Frontend..."
	@-if [ -f frontend.pid ]; then kill `cat frontend.pid` 2>/dev/null || true; rm -f frontend.pid; fi
	@echo "🛑 Anchor has been stopped."

# Tail the logs for both services
logs:
	tail -f backend.log frontend.log

# Stop the app and clean up log/pid files
clean: stop
	@rm -f backend.log frontend.log backend.pid frontend.pid
	@echo "🧹 Logs and PID files cleaned."
