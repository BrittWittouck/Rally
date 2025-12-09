const scenes = ["start", "trainingHub", "passLearn", "passPractice", "spikeLearn", "spikePractice", "blockLearn", "blockPractice", "transition", "match"];

const app = document.getElementById("app");
const panels = document.querySelectorAll("[data-scene-panel]");
const indicators = document.querySelectorAll("[data-indicator]");

let currentScene = "start";

// Progress tracking
const progressState = {
  completed: {
    pass: false,
    spike: false,
    block: false
  }
};

// NEW - ML5 Pose Detection variables
let $canvas, $poseResults, $progressRing, $practiceCount;
let video, ctx;
let bodyPose, classifier;
let poses = [];
let modelsLoaded = false;

// Pose challenge variables
let isCheckingPose = false;
let poseHoldStartTime = null;
let poseHoldTimeout = null;
let countdownInterval = null;
let currentPoseType = null; // Track which pose we're practicing

const HOLD_DURATION = 2000; // 2 seconds

let currentSceneIndex = 0;

const showScene = (sceneName) => {
  currentScene = sceneName;
  currentSceneIndex = scenes.indexOf(sceneName);

  // Update active scene
  panels.forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.scenePanel === sceneName);
  });

  // Update indicators
  updateIndicators();

  // Animate stadium elements on start scene
  if (sceneName === 'start') {
    const courtLine = document.getElementById('courtLine');
    if (courtLine) {
      gsap.fromTo(courtLine,
        { scaleX: 0, opacity: 0 },
        { scaleX: 1, opacity: 0.6, duration: 1.5, ease: 'power2.out', delay: 0.3 }
      );
    }

    // Animate coach messages in
    gsap.fromTo('.coach-message',
      { opacity: 0, x: -30 },
      { opacity: 1, x: 0, duration: 0.8, stagger: 0.3, delay: 0.3, ease: 'power2.out' }
    );
  }

  // Update training hub when entering
  if (sceneName === 'trainingHub') {
    updateTrainingHub();

    // Animate tiles in
    gsap.fromTo('.training-tile',
      { opacity: 0, y: 40 },
      { opacity: 1, y: 0, duration: 0.8, stagger: 0.15, delay: 0.3, ease: 'back.out(1.2)' }
    );
  }

  // Initialize pose detection when entering practice scenes
  if (sceneName === 'passPractice') {
    currentPoseType = 'pass';
    initPoseDetection();
  } else if (sceneName === 'spikePractice') {
    currentPoseType = 'spike';
    initPoseDetection();
  } else if (sceneName === 'blockPractice') {
    currentPoseType = 'block';
    initPoseDetection();
  } else if (sceneName === 'match') {
    initMatchMode();
  }
};

// Setup button navigation
const nextButtons = document.querySelectorAll("[data-next]");
nextButtons.forEach((btn) =>
  btn.addEventListener("click", () => showScene(btn.dataset.next))
);

// Setup progress nav click navigation
indicators.forEach((indicator) => {
  indicator.addEventListener("click", () => {
    const sceneName = indicator.dataset.indicator;
    showScene(sceneName);
  });
  indicator.style.cursor = "pointer";
});

const updateIndicators = () => {
  app.dataset.scene = currentScene;
  indicators.forEach((indicator) => {
    indicator.classList.toggle("is-active", indicator.dataset.indicator === currentScene);
  });
};

// Update training hub tiles based on progress
const updateTrainingHub = () => {
  const tiles = document.querySelectorAll('.training-tile');
  const badge = document.getElementById('activeBadge');

  // Determine current active pose
  let currentActivePose = 'pass';
  if (progressState.completed.spike) {
    currentActivePose = 'block';
  } else if (progressState.completed.pass) {
    currentActivePose = 'spike';
  }

  // Get the state before changes for FLIP
  const state = Flip.getState(badge);

  tiles.forEach(tile => {
    const pose = tile.dataset.pose;
    const button = tile.querySelector('.tile-cta');

    if (pose === 'pass') {
      // Pass is always unlocked
      tile.classList.add('active');
      tile.classList.remove('locked');
      if (button) button.disabled = false;
    } else if (pose === 'spike') {
      // Spike unlocks after pass completion
      if (progressState.completed.pass) {
        tile.classList.add('active');
        tile.classList.remove('locked');
        if (button) button.disabled = false;
        const lockIcon = tile.querySelector('.tile-lock-icon');
        if (lockIcon) lockIcon.style.display = 'none';
      }
    } else if (pose === 'block') {
      // Block unlocks after spike completion
      if (progressState.completed.spike) {
        tile.classList.add('active');
        tile.classList.remove('locked');
        if (button) button.disabled = false;
        const lockIcon = tile.querySelector('.tile-lock-icon');
        if (lockIcon) lockIcon.style.display = 'none';
      }
    }

    // Move badge to current active tile
    if (pose === currentActivePose && badge) {
      const targetTile = tile;
      // Check if badge needs to move
      if (badge.parentElement !== targetTile) {
        targetTile.insertBefore(badge, targetTile.querySelector('.tile-title'));
      }
    }
  });

  // Animate the badge movement with FLIP
  if (badge) {
    Flip.from(state, {
      duration: 0.6,
      ease: "power2.inOut",
      absolute: true,
      scale: true
    });
  }
};

// Update status bar feedback
const updateStatusBar = (status, type = 'ready') => {
  let statusBar;
  if (currentPoseType === 'pass') {
    statusBar = document.getElementById('passStatus');
  } else if (currentPoseType === 'spike') {
    statusBar = document.getElementById('spikeStatus');
  } else if (currentPoseType === 'block') {
    statusBar = document.getElementById('blockStatus');
  }

  if (statusBar) {
    statusBar.textContent = status;
    statusBar.className = 'status-bar ' + type;
  }
};

// Show feedback panel
const showFeedback = (success = true, message = '') => {
  let feedbackPanel, feedbackContent;

  if (currentPoseType === 'pass') {
    feedbackPanel = document.getElementById('passFeedback');
  } else if (currentPoseType === 'spike') {
    feedbackPanel = document.getElementById('spikeFeedback');
  } else if (currentPoseType === 'block') {
    feedbackPanel = document.getElementById('blockFeedback');
  }

  if (feedbackPanel) {
    feedbackContent = feedbackPanel.querySelector('.feedback-content');
    feedbackContent.className = 'feedback-content ' + (success ? 'success' : 'tips');

    if (!success && message) {
      const messagePara = document.createElement('p');
      messagePara.textContent = message;
      feedbackContent.innerHTML = '';
      feedbackContent.className = 'feedback-content tips';
      feedbackContent.appendChild(messagePara);
    } else if (success) {
      feedbackContent.innerHTML = '';
      feedbackContent.className = 'feedback-content success';
    }

    feedbackPanel.classList.add('visible');
  }
}

// Mark pose as completed
const markPoseCompleted = (poseType) => {
  progressState.completed[poseType] = true;
  updateTrainingHub();
};

// NEW - ML5 Pose Detection initialization
const initPoseDetection = async () => {
  // Get canvas based on current scene
  if (currentPoseType === 'pass') {
    $canvas = document.querySelector("#poseCanvas");
    $poseResults = document.querySelector("#poseResults");
    $progressRing = document.querySelector(".ring-progress");
    $practiceCount = document.querySelector("#practiceCount");
  } else if (currentPoseType === 'spike') {
    $canvas = document.querySelector("#spikeCanvas");
    $poseResults = document.querySelector("#spikeResults");
    $progressRing = document.querySelectorAll(".ring-progress")[1];
    $practiceCount = document.querySelector("#spikeCount");
  } else if (currentPoseType === 'block') {
    $canvas = document.querySelector("#blockCanvas");
    $poseResults = document.querySelector("#blockResults");
    $progressRing = document.querySelectorAll(".ring-progress")[2];
    $practiceCount = document.querySelector("#blockCount");
  }

  $poseResults.textContent = "Loading models...";

  try {
    // Load models only once
    if (!modelsLoaded) {
      // Load bodypose model
      bodyPose = await ml5.bodyPose("BlazePose");

      // Load the classifier
      ml5.setBackend("webgl");
      classifier = await ml5.neuralNetwork({ task: "classification", debug: false });

      const origin = new URL(window.location.href);
      const modelURL = new URL("models/volleyball-poses/model.json", origin);
      await classifier.load(modelURL.toString());

      modelsLoaded = true;
    }

    // Setup video (create new stream for each scene)
    ctx = $canvas.getContext("2d");

    if (!video || !video.srcObject) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 }
      });

      video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
    }

    $canvas.width = video.width = 640;
    $canvas.height = video.height = 480;

    // Start detecting poses
    if (modelsLoaded) {
      bodyPose.detectStart(video, (results) => {
        poses = results;

        // If we have a pose, classify it
        if (poses.length > 0 && isCheckingPose) {
          const keypoints = poses[0].keypoints.map(({ x, y }) => [x, y]).flat();
          classifier.classify(keypoints, (results) => {
            if (results.length > 0) {
              checkCurrentPose(results[0]);
            }
          });
        }
      });
    }

    // Setup countdown ring
    if ($progressRing) {
      const radius = Number($progressRing.getAttribute("r"));
      const circumference = 2 * Math.PI * radius;
      $progressRing.style.strokeDasharray = circumference;
      $progressRing.style.strokeDashoffset = circumference;
    }

    $poseResults.textContent = `Ready! Show me the ${currentPoseType} pose...`;

    // Start the single pose challenge
    setTimeout(() => startSinglePoseChallenge(), 1000);

    // Start drawing video
    drawVideo();

  } catch (error) {
    console.error("Error:", error);
    $poseResults.textContent = "Error loading. Check console.";
  }
};

// ========== POSE CHALLENGE LOGIC ==========

function startSinglePoseChallenge() {
  isCheckingPose = true;
  poseHoldStartTime = null;
  startSinglePose();
}

function checkCurrentPose(topResult) {
  if (!isCheckingPose) return;

  const targetPose = currentPoseType;
  const confidence = topResult.confidence;

  // Check if detected pose matches target with good confidence
  if (topResult.label.toLowerCase() === targetPose.toLowerCase() && confidence > 0.7) {
    // Correct pose detected
    if (!poseHoldStartTime) {
      poseHoldStartTime = Date.now();
      $poseResults.textContent = `${topResult.label} detected`;
      updateStatusBar('Hold now!', 'hold');
    } else {
      const holdTime = ((Date.now() - poseHoldStartTime) / 1000).toFixed(1);
      $poseResults.textContent = `${topResult.label} ✓ (${holdTime}s)`;
      updateStatusBar('Hold now!', 'hold');

      if ((Date.now() - poseHoldStartTime) >= HOLD_DURATION) {
        // Successfully held for 2 seconds
        updateStatusBar('Done!', 'success');
        completeSinglePose();
      }
    }
  } else {
    // Wrong pose or low confidence - reset hold timer
    if (poseHoldStartTime) {
      poseHoldStartTime = null;
      updateStatusBar('Almost!', 'almost');
    }
    $poseResults.textContent = `Detected: ${topResult.label} (${Math.round(confidence * 100)}%)`;
  }
}

function startSinglePose() {
  isCheckingPose = true;
  poseHoldStartTime = null;

  $poseResults.textContent = `Show me: ${currentPoseType}`;

  // Set status based on pose type
  if (currentPoseType === 'pass') {
    updateStatusBar('Get into your passing position...', 'ready');
  } else if (currentPoseType === 'spike') {
    updateStatusBar('Prepare your jump...', 'ready');
  } else {
    updateStatusBar('Get ready...', 'ready');
  }

  // Reset and animate countdown ring
  resetRing();

  let countdown = 5;
  setCount(countdown);

  // GSAP countdown animation
  gsap.to($progressRing, {
    strokeDashoffset: 0,
    duration: 5,
    ease: "none"
  });

  // Update countdown number every second
  countdownInterval = setInterval(() => {
    countdown--;
    setCount(countdown);

    // Update status on last second
    if (countdown === 1) {
      if (currentPoseType === 'pass') {
        updateStatusBar('Stay low, keep your arms still!', 'hold');
      } else if (currentPoseType === 'spike') {
        updateStatusBar('Stretch your arm out completely!', 'hold');
      }
    }

    if (countdown <= 0) {
      clearInterval(countdownInterval);
      isCheckingPose = false;
      updateStatusBar('Time expired', 'almost');

      // Show tips feedback
      let tipMessage = '';
      if (currentPoseType === 'pass') {
        tipMessage = 'Not quite there yet. Try to lower yourself a little more and stretch your arms better.';
      } else if (currentPoseType === 'spike') {
        tipMessage = 'Almost! Try to raise your arm a little higher and open your upper body more.';
      } else if (currentPoseType === 'block') {
        tipMessage = 'Not quite. Make sure both arms are at the same height and not too far back.';
      }
      showFeedback(false, tipMessage);

      // Timer finished - show try again button
      $poseResults.innerHTML = `<br><button onclick="startSinglePoseChallenge()" style="margin-top: 1rem; padding: 0.8rem 1.5rem; cursor: pointer; background: var(--light-blue); color: #fff; border: none; border-radius: 8px;">Try again</button><br><small style="margin-top: 0.5rem; display: block; color: var(--muted); font-style: italic;">Tip: take a look at the example on the left.</small>`;
    }
  }, 1000);
}

function completeSinglePose() {
  isCheckingPose = false;
  clearInterval(countdownInterval);

  // Mark pose as completed
  markPoseCompleted(currentPoseType);

  // Show success feedback
  showFeedback(true);

  // Show completion message with button
  let nextScene;
  if (currentPoseType === 'pass') {
    nextScene = 'spikeLearn';
    $poseResults.innerHTML = `Well done!<br>Your passing position is already good. Ready for the next one?<br><div style="margin-top: 1.5rem; display: flex; gap: 1rem;"><button data-next="spikeLearn" style="padding: 0.8rem 1.5rem; background: var(--ball-yellow); color: var(--dark-blue); border: none; border-radius: 8px; font-weight: 700; cursor: pointer;">Go to Spike</button><button onclick="startSinglePoseChallenge()" style="padding: 0.8rem 1.5rem; background: transparent; color: var(--light-blue); border: 2px solid var(--light-blue); border-radius: 8px; cursor: pointer;">Practice again</button></div>`;
  } else if (currentPoseType === 'spike') {
    nextScene = 'blockLearn';
    $poseResults.innerHTML = `Yes! Nice spike position.<br>Your attack is ready. Time to build the wall.<br><div style="margin-top: 1.5rem; display: flex; gap: 1rem;"><button data-next="blockLearn" style="padding: 0.8rem 1.5rem; background: var(--ball-yellow); color: var(--dark-blue); border: none; border-radius: 8px; font-weight: 700; cursor: pointer;">Train Block</button><button onclick="startSinglePoseChallenge()" style="padding: 0.8rem 1.5rem; background: transparent; color: var(--light-blue); border: 2px solid var(--light-blue); border-radius: 8px; cursor: pointer;">Practice spike again</button></div>`;
  } else if (currentPoseType === 'block') {
    nextScene = 'match';
    $poseResults.innerHTML = `Strong block!<br>You are ready for the match.<br><div style="margin-top: 1.5rem; display: flex; gap: 1rem;"><button data-next="match" style="padding: 0.8rem 1.5rem; background: var(--ball-yellow); color: var(--dark-blue); border: none; border-radius: 8px; font-weight: 700; cursor: pointer;">Go to the match</button><button onclick="startSinglePoseChallenge()" style="padding: 0.8rem 1.5rem; background: transparent; color: var(--light-blue); border: 2px solid var(--light-blue); border-radius: 8px; cursor: pointer;">Practice the block again</button></div>`;
  }

  // Re-attach button event listener
  const nextBtn = $poseResults.querySelector('button');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => showScene(nextBtn.dataset.next));
  }
}

function setCount(value) {
  $practiceCount.textContent = value;
  $practiceCount.setAttribute("data-value", value);
}

function resetRing() {
  const radius = Number($progressRing.getAttribute("r"));
  const circumference = 2 * Math.PI * radius;
  $progressRing.style.strokeDashoffset = circumference;
}

const drawVideo = () => {
  const isPracticeScene = currentScene === 'passPractice' || currentScene === 'spikePractice' || currentScene === 'blockPractice';
  const isMatchScene = currentScene === 'match';

  // Determine which canvas and context to use
  const activeCanvas = isMatchScene ? matchCanvas : $canvas;
  const activeCtx = isMatchScene ? matchCtx : ctx;

  if (activeCtx && video && activeCanvas && (isPracticeScene || isMatchScene)) {
    activeCtx.drawImage(video, 0, 0, activeCanvas.width, activeCanvas.height);

    // Draw pose keypoints
    activeCtx.fillStyle = "#ffb347";
    poses.forEach((pose) => {
      pose.keypoints.forEach((keypoint) => {
        if (keypoint.confidence > 0.2) {
          activeCtx.beginPath();
          activeCtx.arc(keypoint.x, keypoint.y, 8, 0, 2 * Math.PI);
          activeCtx.fill();
        }
      });
    });
  }

  requestAnimationFrame(drawVideo);
};

// ========== MATCH MODE LOGIC ==========

let matchCanvas, matchPoseLabel, matchCount, matchProgressRing;
let matchStartBtn, matchRestartBtn, matchScore, matchRemaining;
let matchCtx; // Add dedicated context for match canvas
let isMatchActive = false;
let matchCurrentPoseIndex = 0;
let matchPoseHoldStartTime = null;
let matchPoseHoldTimeout = null;
let matchCountdownInterval = null;
let matchCompletedPoses = 0;
let opponentScore = 0; // Track opponent's score
let usedPoses = []; // Track which poses have been used in this match

const MATCH_POSES = ['pass', 'spike', 'block'];
const MATCH_TOTAL_POSES = 3;

const initMatchMode = async () => {
  matchCanvas = document.querySelector('#matchCanvas');
  matchPoseLabel = document.querySelector('#matchPoseLabel');
  matchCount = document.querySelector('#matchCount');
  matchProgressRing = document.querySelectorAll('.ring-progress')[3]; // 4th ring (0-indexed: pass, spike, block, match)
  matchStartBtn = document.querySelector('#matchStartBtn');
  matchRestartBtn = document.querySelector('#matchRestartBtn');
  matchScore = document.querySelector('#matchScore');
  matchRemaining = document.querySelector('#matchRemaining');

  try {
    // Load models only once (should already be loaded from practice)
    if (!modelsLoaded) {
      bodyPose = await ml5.bodyPose("BlazePose");

      ml5.setBackend("webgl");
      classifier = await ml5.neuralNetwork({ task: "classification", debug: false });

      const origin = new URL(window.location.href);
      const modelURL = new URL("models/volleyball-poses/model.json", origin);
      await classifier.load(modelURL.toString());

      modelsLoaded = true;
    }

    // Setup video and canvas for match
    matchCtx = matchCanvas.getContext("2d");

    if (!video || !video.srcObject) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 }
      });

      video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
    }

    matchCanvas.width = 640;
    matchCanvas.height = 480;
    video.width = 640;
    video.height = 480;

    // Start detecting poses
    if (modelsLoaded) {
      bodyPose.detectStart(video, (results) => {
        poses = results;

        // If we have a pose and match is active, classify it
        if (poses.length > 0 && isMatchActive && isCheckingPose) {
          const keypoints = poses[0].keypoints.map(({ x, y }) => [x, y]).flat();
          classifier.classify(keypoints, (results) => {
            if (results.length > 0) {
              checkMatchPose(results[0]);
            }
          });
        }
      });
    }

    // Setup countdown ring for match
    if (matchProgressRing) {
      const radius = Number(matchProgressRing.getAttribute("r"));
      const circumference = 2 * Math.PI * radius;
      matchProgressRing.style.strokeDasharray = circumference;
      matchProgressRing.style.strokeDashoffset = circumference;
    }

    // Setup button listeners (remove old listeners first)
    if (matchStartBtn) {
      matchStartBtn.replaceWith(matchStartBtn.cloneNode(true));
      matchStartBtn = document.querySelector('#matchStartBtn');
      matchStartBtn.addEventListener('click', startMatch);
    }

    if (matchRestartBtn) {
      matchRestartBtn.replaceWith(matchRestartBtn.cloneNode(true));
      matchRestartBtn = document.querySelector('#matchRestartBtn');
      matchRestartBtn.addEventListener('click', restartMatch);
    }

    // Start drawing video
    drawVideo();

  } catch (error) {
    console.error("Match mode error:", error);
  }
};

const startMatch = () => {
  isMatchActive = true;
  matchCompletedPoses = 0;
  opponentScore = 0; // Reset opponent score
  usedPoses = []; // Reset used poses for new match
  matchCurrentPoseIndex = 0;
  matchStartBtn.style.display = 'none';
  matchRestartBtn.style.display = 'none';

  // Reset scoreboard
  document.querySelectorAll('#playerRounds .round-dot').forEach(dot => dot.classList.remove('lit'));
  document.querySelectorAll('#opponentRounds .round-dot').forEach(dot => dot.classList.remove('lit'));

  // Hide intro text, show pose callout and results
  if (matchPoseLabel) matchPoseLabel.style.display = 'none';
  const matchSubtitle = document.querySelector('.match-subtitle');
  if (matchSubtitle) matchSubtitle.style.display = 'none';

  startNextMatchPose();
};

const restartMatch = () => {
  matchRestartBtn.style.display = 'none';
  startMatch();
};

const startNextMatchPose = () => {
  // Check if either player has won
  if (matchCompletedPoses >= MATCH_TOTAL_POSES || opponentScore >= MATCH_TOTAL_POSES) {
    completeMatch();
    return;
  }

  // Pick a random pose, avoiding consecutive repeats
  let randomPose;
  const lastPose = usedPoses[usedPoses.length - 1];

  if (lastPose) {
    // Don't pick the same pose as last time
    const availablePoses = MATCH_POSES.filter(pose => pose !== lastPose);
    randomPose = availablePoses[Math.floor(Math.random() * availablePoses.length)];
  } else {
    // First pose - pick any
    randomPose = MATCH_POSES[Math.floor(Math.random() * MATCH_POSES.length)];
  }

  usedPoses.push(randomPose);
  currentPoseType = randomPose;

  isCheckingPose = true;
  matchPoseHoldStartTime = null;

  // Update pose callout UI
  const poseCallout = document.querySelector('#poseCallout');
  const poseNumber = document.querySelector('#poseNumber');
  const poseName = document.querySelector('#poseName');
  const poseHint = document.querySelector('#poseHint');

  if (poseCallout) poseCallout.style.display = 'flex';
  if (poseNumber) poseNumber.textContent = `POSE ${matchCompletedPoses + 1}`;
  if (poseName) poseName.textContent = randomPose.toUpperCase();

  // Set hint text
  const hints = {
    'pass': 'Stay low',
    'spike': 'Stretch your arm',
    'block': 'Wall up'
  };
  if (poseHint) {
    poseHint.textContent = hints[randomPose] || '';
    poseHint.style.display = 'block';
  }

  // Update status bar
  const matchStatus = document.getElementById('matchStatus');
  if (matchStatus) {
    matchStatus.textContent = `Show ${randomPose} pose!`;
  }

  // Reset and animate countdown ring
  resetMatchRing();

  let countdown = 5;
  matchCount.textContent = countdown;

  // GSAP countdown animation
  gsap.to(matchProgressRing, {
    strokeDashoffset: 0,
    duration: 5,
    ease: "none"
  });

  // Update countdown number every second
  matchCountdownInterval = setInterval(() => {
    countdown--;
    matchCount.textContent = countdown;
    if (countdown <= 0) {
      clearInterval(matchCountdownInterval);
      isCheckingPose = false;

      // Time's up - opponent scores
      opponentScore++;

      // Light up opponent's scoreboard dot
      const opponentDots = document.querySelectorAll('#opponentRounds .round-dot');
      if (opponentDots[opponentScore - 1]) {
        opponentDots[opponentScore - 1].classList.add('lit');
      }

      // Check if match is over (either player or opponent reached 3 points)
      if (matchCompletedPoses >= MATCH_TOTAL_POSES || opponentScore >= MATCH_TOTAL_POSES) {
        setTimeout(() => {
          completeMatch();
        }, 1500);
      } else {
        setTimeout(() => {
          startNextMatchPose();
        }, 1500);
      }
    }
  }, 1000);
};

const checkMatchPose = (topResult) => {
  if (!isCheckingPose || !isMatchActive) return;

  const targetPose = currentPoseType;
  const confidence = topResult.confidence;

  // Check if detected pose matches target with good confidence
  if (topResult.label.toLowerCase() === targetPose.toLowerCase() && confidence > 0.7) {
    // Correct pose detected
    if (!matchPoseHoldStartTime) {
      matchPoseHoldStartTime = Date.now();
      const matchStatus = document.getElementById('matchStatus');
      if (matchStatus) matchStatus.textContent = 'Hold it!';
    } else {
      if ((Date.now() - matchPoseHoldStartTime) >= HOLD_DURATION) {
        // Successfully held for 2 seconds
        completeMatchPose();
      }
    }
  } else {
    // Wrong pose or low confidence - reset hold timer
    if (matchPoseHoldStartTime) {
      matchPoseHoldStartTime = null;
    }
  }
};

const completeMatchPose = () => {
  isCheckingPose = false;
  clearInterval(matchCountdownInterval);
  matchPoseHoldStartTime = null;

  matchCompletedPoses++;

  // Light up the scoreboard dot
  const playerDots = document.querySelectorAll('#playerRounds .round-dot');
  if (playerDots[matchCompletedPoses - 1]) {
    playerDots[matchCompletedPoses - 1].classList.add('lit');
  }

  // Update status bar
  const matchStatus = document.getElementById('matchStatus');
  if (matchStatus) matchStatus.textContent = `Perfect ${currentPoseType}! ✓`;

  // Flash green on canvas
  const matchCanvas = document.getElementById('matchCanvas');
  if (matchCanvas) {
    matchCanvas.classList.add('success');
    setTimeout(() => matchCanvas.classList.remove('success'), 600);
  }

  setTimeout(() => {
    startNextMatchPose();
  }, 1500);
};

const completeMatch = () => {
  isMatchActive = false;
  isCheckingPose = false;
  clearInterval(matchCountdownInterval);

  // Hide pose callout
  const poseCallout = document.querySelector('#poseCallout');
  const poseHint = document.querySelector('#poseHint');
  if (poseCallout) poseCallout.style.display = 'none';
  if (poseHint) poseHint.style.display = 'none';

  if (matchCompletedPoses === MATCH_TOTAL_POSES) {
    // Win state - trigger confetti!
    createConfetti();

    matchPoseLabel.textContent = "You win the rally! 🏆";
    matchPoseLabel.style.display = 'block';

    // Show buttons
    const actionsDiv = document.querySelector('.scene.match .actions');
    if (actionsDiv) {
      actionsDiv.innerHTML = `
        <button onclick="restartMatch()" style="padding: 1rem 2rem; background: var(--ball-yellow); color: var(--dark-blue); border: none; border-radius: 12px; font-weight: 700; cursor: pointer;">Play another match</button>
        <button onclick="showScene('trainingHub')" style="padding: 1rem 2rem; background: transparent; color: var(--light-blue); border: 2px solid var(--light-blue); border-radius: 12px; cursor: pointer;">Review my training</button>
      `;
      actionsDiv.style.display = 'flex';
      actionsDiv.style.gap = '1rem';
      actionsDiv.style.marginTop = '2rem';
      actionsDiv.style.flexWrap = 'wrap';
    }
  } else {
    // Lose state  
    matchPoseLabel.textContent = "The opponent scores this point.";
    matchPoseLabel.style.display = 'block';

    const actionsDiv = document.querySelector('.scene.match .actions');
    if (actionsDiv) {
      actionsDiv.innerHTML = `
        <button onclick="restartMatch()" style="padding: 1rem 2rem; background: var(--ball-yellow); color: var(--dark-blue); border: none; border-radius: 12px; font-weight: 700; cursor: pointer;">Play match again</button>
        <button onclick="showScene('trainingHub')" style="padding: 1rem 2rem; background: transparent; color: var(--light-blue); border: 2px solid var(--light-blue); border-radius: 12px; cursor: pointer;">Go back to training</button>
      `;
      actionsDiv.style.display = 'flex';
      actionsDiv.style.gap = '1rem';
      actionsDiv.style.marginTop = '2rem';
      actionsDiv.style.flexWrap = 'wrap';
    }
  }
};

const updateMatchScore = () => {
  matchScore.textContent = matchCompletedPoses;
  matchRemaining.textContent = MATCH_TOTAL_POSES - matchCompletedPoses;
};

const resetMatchRing = () => {
  if (matchProgressRing) {
    const radius = Number(matchProgressRing.getAttribute("r"));
    const circumference = 2 * Math.PI * radius;
    matchProgressRing.style.strokeDashoffset = circumference;
  }
};

// ========== CONFETTI ANIMATION ==========

const createConfetti = () => {
  const colors = ['#FFD700', '#13678A', '#0B2545', '#FFFFFF'];
  const confettiCount = 100;
  const container = document.body;

  for (let i = 0; i < confettiCount; i++) {
    const confetti = document.createElement('div');
    confetti.style.position = 'fixed';
    confetti.style.width = '10px';
    confetti.style.height = '10px';
    confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    confetti.style.left = Math.random() * 100 + '%';
    confetti.style.top = '-10px';
    confetti.style.opacity = '1';
    confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
    confetti.style.zIndex = '9999';
    confetti.style.pointerEvents = 'none';

    container.appendChild(confetti);

    // Animate with GSAP
    gsap.to(confetti, {
      y: window.innerHeight + 100,
      x: (Math.random() - 0.5) * 400,
      rotation: Math.random() * 720 - 360,
      opacity: 0,
      duration: 2 + Math.random() * 2,
      ease: 'power1.in',
      delay: Math.random() * 0.3,
      onComplete: () => {
        confetti.remove();
      }
    });
  }
};

// ========== GSAP ANIMATIONS SETUP ==========

const initGSAPPlugins = () => {
  gsap.registerPlugin(Flip, ScrollTrigger, MotionPathPlugin);
};

const initScrollAnimations = () => {
  const startScene = document.querySelector('.scene.start');
  const ball = document.getElementById('startBall');

  if (!startScene) return;

  // Animate training steps on scroll
  gsap.fromTo('.training-steps .step',
    {
      opacity: 0,
      y: 60,
      scale: 0.9
    },
    {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: 0.8,
      stagger: 0.2,
      ease: 'back.out(1.7)',
      scrollTrigger: {
        trigger: '.training-steps',
        scroller: startScene,
        start: 'top 80%',
        end: 'top 30%',
        toggleActions: 'play none none reverse'
      }
    }
  );

  // Animate ball through the story with motion path
  if (ball) {
    gsap.to(ball, {
      scrollTrigger: {
        trigger: startScene,
        scroller: startScene,
        start: 'top top',
        end: 'bottom top',
        scrub: 1.5
      },
      motionPath: {
        path: [
          { x: 0, y: 0 },
          { x: -100, y: 150 },
          { x: -300, y: 350 },
          { x: -600, y: 450 },
          { x: -900, y: 300 },
          { x: -1200, y: 100 }
        ],
        curviness: 1.5
      },
      rotation: 1080,
      scale: 0.6,
      ease: 'none'
    });
  }
};

// ========== MAIN INITIALIZATION ==========

const init = () => {
  // Initialize GSAP plugins
  initGSAPPlugins();

  // Setup scroll-based animations
  initScrollAnimations();

  // Show initial scene
  showScene('start');
};

// Initialize application on page load
init();