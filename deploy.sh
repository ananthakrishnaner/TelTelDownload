#!/bin/bash
sshpass -p "aK@test#123aK" ssh -o StrictHostKeyChecking=no root@206.189.143.138 "apt-get update && apt-get install -y git docker.io docker-compose && rm -rf TelTelDownload && git clone https://github.com/ananthakrishnaner/TelTelDownload.git && cd TelTelDownload && docker-compose up -d --build"
