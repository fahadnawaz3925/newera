#!/bin/bash
set -e

echo "----------------------------------------"
echo "1. CREATING 2GB SWAP FILE"
echo "----------------------------------------"
if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "Swap created successfully!"
else
    echo "Swap file already exists."
fi

echo "----------------------------------------"
echo "2. UPDATING SYSTEM & INSTALLING DEPS"
echo "----------------------------------------"
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y python3 python-is-python3 git ffmpeg curl

echo "Installing Node.js 20.x..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

echo "----------------------------------------"
echo "3. CLONING REPOSITORY"
echo "----------------------------------------"
if [ -d "/home/ubuntu/newera" ]; then
    cd /home/ubuntu/newera
    git pull origin main
else
    git clone https://github.com/fahadnawaz3925/newera.git /home/ubuntu/newera
    cd /home/ubuntu/newera
fi

echo "Copying .env file..."
cp /home/ubuntu/.env /home/ubuntu/newera/.env

echo "----------------------------------------"
echo "4. INSTALLING NPM PACKAGES"
echo "----------------------------------------"
# Install heavily using the swap file
npm install

echo "----------------------------------------"
echo "5. STARTING PM2 DAEMON"
echo "----------------------------------------"
pm2 start standalone-worker.js --name "reels-worker"
pm2 save
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ubuntu --hp /home/ubuntu

echo "Deployment complete! ✅"
