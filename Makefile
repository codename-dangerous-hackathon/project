.PHONY: install build start stop logs clean

# Install all dependencies for both backend and frontend
install:
	@echo "Installing Backend dependencies (Virtual Environment)..."
	@python3 -m venv venv
	@./venv/bin/pip install -Ur requirements.txt
	@echo "Installing Frontend dependencies (npm)..."
	@cd src/frontend && npm install
	@echo "✅ All dependencies installed locally."

# Build the frontend (Next.js production build)
build:
	@echo "Building Frontend (Next.js)..."
	@cd src/frontend && npm run build
	@echo "✅ Frontend built successfully."

# Start both the backend and frontend in the background
start: stop
	@echo "Starting Backend (FastAPI)..."
	@cd src/backend && setsid nohup ../../venv/bin/uvicorn main:app --host 127.0.0.1 --port 8001 --reload > ../../backend.log 2>&1 & echo $$! > backend.pid
	@echo "Starting Frontend (Next.js)..."
	@cd src/frontend && setsid nohup npm start > ../../frontend.log 2>&1 & echo $$! > frontend.pid
	@echo "========================================="
	@echo "✅ Belong is running in the background!"
	@echo "Frontend: http://localhost:3000"
	@echo "Backend : http://127.0.0.1:8001"
	@echo "To view logs, run: make logs"
	@echo "To stop, run:      make stop"
	@echo "========================================="

# Stop the background processes (kills the whole process group, then any
# orphan still holding the ports — robust against failed/double starts)
stop:
	@echo "Stopping Backend..."
	@-if [ -f backend.pid ]; then kill -- -`cat backend.pid` 2>/dev/null || true; rm -f backend.pid; fi
	@echo "Stopping Frontend..."
	@-if [ -f frontend.pid ]; then kill -- -`cat frontend.pid` 2>/dev/null || true; rm -f frontend.pid; fi
	@-fuser -k 8001/tcp 3000/tcp 2>/dev/null || true
	@echo "🛑 Belong has been stopped."

# Tail the logs for both services
logs:
	tail -f backend.log frontend.log

# Stop the app and clean up log/pid files
clean: stop
	@rm -f backend.log frontend.log backend.pid frontend.pid
	@echo "🧹 Logs and PID files cleaned."
