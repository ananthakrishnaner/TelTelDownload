# Telegram Media Manager (TelTel)

TelTel is a full-stack Node.js application designed to manage, download, and schedule media from Telegram channels. It uses the MTProto API (via GramJS) to log in with a personal Telegram account securely.

## Features
- **MTProto Integration**: Secure OTP and 2FA login flow for personal Telegram accounts.
- **Media Downloader**: Download media content from specified Telegram channels.
- **Scheduler**: Set up cron jobs to automatically download media at specific intervals.
- **Admin Dashboard**: A React-based UI to view downloaded media, configure Telegram API settings, and manage scheduled tasks.
- **Containerized Architecture**: Fully Dockerized with `docker-compose` for easy deployment.

## Tech Stack
- **Frontend**: React, Vite, TailwindCSS
- **Backend**: Node.js, Express.js, GramJS
- **Database**: MongoDB
- **Containerization**: Docker & Docker Compose

## Getting Started

### Prerequisites
- Docker and Docker Compose installed on your machine.
- A Telegram API ID and API Hash (obtainable from [my.telegram.org](https://my.telegram.org)).

### Installation
1. Clone this repository.
2. Start the application using Docker Compose:
   ```bash
   docker-compose up -d --build
   ```
3. Access the Admin Dashboard at `http://localhost:5173`.
4. The backend API will be running at `http://localhost:5000`.

### Configuration
1. Log in to the Admin Dashboard using the default credentials (`admin` / `admin`).
2. Navigate to the **Settings** page.
3. Enter your Telegram API credentials and phone number to initiate the OTP/2FA login flow.
4. Once authenticated, the session is securely stored in MongoDB and persists across restarts.
