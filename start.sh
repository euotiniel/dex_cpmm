#!/bin/bash

echo "Abrindo Terminal 1 (bootstrap)..."
yarn bootstrap:local &

sleep 5

echo "Abrindo Terminal 2 (setup + backend)..."
gnome-terminal -- bash -c "yarn setup:local && yarn backend; exec bash"
