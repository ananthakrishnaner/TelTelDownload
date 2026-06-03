#!/bin/bash
sshpass -p "aK@test#123aK" ssh -o StrictHostKeyChecking=no root@206.189.143.138 "apt-get update && apt-get install -y git docker.io docker-compose && cd TelTelDownload && git reset --hard origin/main && git pull origin main && docker-compose down --remove-orphans || true && docker ps -aq | xargs -r docker rm -f || true && docker-compose up -d --build"
