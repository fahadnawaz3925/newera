#!/bin/bash
set -e

echo "Updating system..."
sudo apt-get update
sudo apt-get upgrade -y

echo "Installing dependencies (Node.js, Git, FFmpeg)..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git ffmpeg

echo "Installing PM2 globally..."
sudo npm install -g pm2

echo "Cloning repository..."
if [ -d "/home/ubuntu/newera" ]; then
    echo "Directory /home/ubuntu/newera already exists. Pulling latest..."
    cd /home/ubuntu/newera
    git pull origin main
else
    git clone https://github.com/fahadnawaz3925/newera.git /home/ubuntu/newera
    cd /home/ubuntu/newera
fi

echo "Copying .env file..."
cp /home/ubuntu/.env /home/ubuntu/newera/.env

echo "Installing NPM packages..."
npm install

echo "Starting PM2 daemon..."
pm2 start standalone-worker.js --name "reels-worker"

echo "Saving PM2 state and setting up startup script..."
pm2 save
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ubuntu --hp /home/ubuntu

echo "Deployment complete! ✅"
