#!/bin/bash
set -e

echo "Installing Python (required for yt-dlp-exec)..."
sudo apt-get install -y python3 python-is-python3

cd /home/ubuntu/newera
echo "Installing NPM packages..."
npm install

echo "Starting PM2 daemon..."
pm2 start standalone-worker.js --name "reels-worker"

echo "Saving PM2 state and setting up startup script..."
pm2 save
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ubuntu --hp /home/ubuntu

echo "Deployment complete! ✅"
