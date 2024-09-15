const puppeteer = require('puppeteer');
const { exec } = require('child_process'); // For executing FFmpeg commands
const axios = require('axios');

async function detectRoomId(url, duration = 30000, streamKey, rtmpServerUrl) {
    const browser = await puppeteer.launch({
        headless: true,  // Set headless to true to run in headless mode
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Required for running in sandbox mode on VPS
    });
    const page = await browser.newPage();

    let roomId = null;
    let aid = null;

    // Listen for network requests
    page.on('request', async (request) => {
        try {
            const requestUrl = request.url();

            // Listen for the TikTok API request containing the "current_room_id"
            if (requestUrl.includes('webcast/user')) {
                const urlParams = new URLSearchParams(requestUrl.split('?')[1]);
                roomId = urlParams.get('current_room_id'); // Extract the room ID from the URL params
                aid = urlParams.get('aid'); // Extract the room ID from the URL params
                
                if (roomId) {
                    console.log(`Room ID Detected: ${roomId}`);
                    console.log(`aid Detected: ${aid}`);

                    // If the room ID is found, stop the network listening and proceed to fetch HLS URL
                    await fetchHlsUrl(aid, roomId, rtmpServerUrl, streamKey);
                    await browser.close();
                }
            }
        } catch (error) {
            console.error(`Error processing request: ${error}`);
        }
    });

    // Navigate to the TikTok livestream URL
    try {
        console.log(`Navigating to TikTok stream URL: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 }); // Extend the timeout to handle slow network
    } catch (err) {
        console.error("Error navigating to the URL (Frame detached or timeout):", err.message);

        // Ensure the browser is closed even in case of navigation error
        try {
            await browser.close();
        } catch (closeErr) {
            console.error("Error closing the browser:", closeErr.message);
        }
    }

    // Listen for the specified duration or until the room ID is detected
    console.log(`Listening for network requests for up to ${duration / 1000} seconds...`);
    await new Promise(resolve => setTimeout(resolve, duration));

    // If no Room ID is detected, close the browser after the timeout
    if (!roomId) {
        console.log("No Room ID detected after the timeout.");
        await browser.close();
    }
}

// Function to fetch HLS URL using Room ID
async function fetchHlsUrl(aid, roomId, rtmpServerUrl, streamKey) {
    const roomInfoUrl = `https://webcast.tiktok.com/webcast/room/info/?aid=${aid}&room_id=${roomId}`;
    try {
        console.log(`Fetching HLS URL for room ID: ${roomId}`);
        const response = await axios.get(roomInfoUrl);
        const roomInfoData = response.data;

        if (roomInfoData.data) {
            const hlsPullUrl = roomInfoData.data.stream_url.hls_pull_url;
            console.log(`HLS URL Detected: ${hlsPullUrl}`);

            // Forward HLS stream to RTMP server
            await forwardToRTMPServer(hlsPullUrl, rtmpServerUrl, streamKey);
        } else {
            console.log("No HLS Pull URL found in room info.");
        }
    } catch (error) {
        console.error(`Error fetching room info: ${error.message}`);
    }
}

// Function to forward the HLS stream URL to the RTMP server using FFmpeg
function forwardToRTMPServer(hlsUrl, rtmpServerUrl, streamKey) {
    const fullRtmpUrl = `${rtmpServerUrl}${streamKey}`;
    console.log(`Forwarding HLS stream ${hlsUrl} to RTMP server at: ${fullRtmpUrl}`);

    // FFmpeg command to forward the HLS stream to the RTMP server
    const ffmpegCommand = `ffmpeg -i "${hlsUrl}" -ar 44100 -vcodec libx264 -r 25 -b:v 500k -f flv ${fullRtmpUrl}`;

    //Execute the FFmpeg command
    exec(ffmpegCommand, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error during FFmpeg execution: ${error.message}`);
            return;
        }

        if (stderr) {
            console.error(`FFmpeg stderr: ${stderr}`);
        }

        console.log(`FFmpeg stdout: ${stdout}`);
        console.log(`HLS stream has been forwarded to RTMP server: ${fullRtmpUrl}`);
    });
}

// Function to read input from the command line
const askQuestion = (query) => {
    return new Promise((resolve) => {
        process.stdout.write(query);
        process.stdin.once('data', (data) => {
            resolve(data.toString().trim());
        });
    });
};

(async () => {
    // Prompt the user for the TikTok URL, stream key, and RTMP server URL
    const tiktokUrl = await askQuestion("Input TikTok URL: ");
    const streamKey = await askQuestion("Input Stream Key: ");
    const rtmpServerUrl = 'rtmps://live.tevi.com:443/live/';

    // Listen for network requests and forward the HLS stream to the RTMP server
    await detectRoomId(tiktokUrl, 30000, streamKey, rtmpServerUrl);

    console.log("Finished detecting stream URLs.");
    process.stdin.pause();  // Stop listening for input
})();