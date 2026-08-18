#!/bin/bash
set -e

echo "Creating 2GB swap file to prevent OOM freezes during npm install..."
if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "Swap created!"
else
    echo "Swap file already exists."
fi

cd /home/ubuntu/newera
echo "Installing NPM packages..."
npm install

echo "Starting PM2 daemon..."
pm2 start standalone-worker.js --name "reels-worker"

echo "Saving PM2 state and setting up startup script..."
pm2 save
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ubuntu --hp /home/ubuntu

echo "Deployment complete! ✅"
