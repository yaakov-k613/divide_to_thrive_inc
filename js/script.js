let player = null;
let ytApiReady = false;
let currentVideoId = null;

const STORAGE_KEYS = {
  url: "dtt_video_url",
  duration: "dtt_segment_duration",
  segments: "dtt_segments_html",
  completed: "dtt_segments_completed"
};

// YouTube IFrame API callback
window.onYouTubeIframeAPIReady = function () {
  ytApiReady = true;
  player = new YT.Player("player", {
    width: "100%",
    height: "360",
    playerVars: {
      rel: 0,
      modestbranding: 1,
      iv_load_policy: 3
    },
    events: { onStateChange: onPlayerStateChange }
  });
};

function onPlayerStateChange(event) {
  const overlay = document.getElementById("player-overlay");
  if (!overlay) return;
  if (event.data === YT.PlayerState.ENDED) {
    overlay.style.display = "flex";
  }
}

// Status helpers
function setStatus(message, isError = false) {
  const statusEl = document.getElementById("status-message");
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("status-message--error", !!isError);
}

function clearStatus() {
  setStatus("");
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("video-form");
  const segmentsBody = document.getElementById("segments-body");
  const urlInput = document.getElementById("video-url");
  const durationInput = document.getElementById("segment-duration");
  const saveUrlBtn = document.getElementById("save-url-btn");
  const clearUrlBtn = document.getElementById("clear-url-btn");
  const overlay = document.getElementById("player-overlay");

  // Restore saved inputs and segments
  const savedUrl = localStorage.getItem(STORAGE_KEYS.url);
  const savedDuration = localStorage.getItem(STORAGE_KEYS.duration);
  const savedSegments = localStorage.getItem(STORAGE_KEYS.segments);

  if (savedUrl) {
    urlInput.value = savedUrl;
    currentVideoId = extractVideoId(savedUrl) || null;
  }
  if (savedDuration) {
    durationInput.value = savedDuration;
  }

  if (savedSegments) {
    segmentsBody.innerHTML = savedSegments;
    restoreCompletionState(segmentsBody);
  } else {
    clearSegments(segmentsBody);
  }

  // Save URL + duration + segments + completion state
  saveUrlBtn.addEventListener("click", () => {
    const url = urlInput.value.trim();
    const dur = durationInput.value.trim();

    if (!url || !dur) {
      setStatus("Enter a video URL and segment duration before adding.", true);
      return;
    }

    localStorage.setItem(STORAGE_KEYS.url, url);
    localStorage.setItem(STORAGE_KEYS.duration, dur);
    localStorage.setItem(STORAGE_KEYS.segments, segmentsBody.innerHTML);
    saveCompletionState(segmentsBody);
    setStatus("Video URL, duration, and segments saved for next time.");
  });

  // Clear everything
  clearUrlBtn.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEYS.url);
    localStorage.removeItem(STORAGE_KEYS.duration);
    localStorage.removeItem(STORAGE_KEYS.segments);
    localStorage.removeItem(STORAGE_KEYS.completed);
    urlInput.value = "";
    durationInput.value = "";
    currentVideoId = null;
    clearSegments(segmentsBody);
    if (overlay) overlay.style.display = "none";
    setStatus("Saved video and segments cleared.");
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearStatus();
    clearSegments(segmentsBody);
    if (overlay) overlay.style.display = "none";

    const videoUrl = urlInput.value.trim();
    const segmentStr = durationInput.value.trim();

    if (!ytApiReady || !player) {
      setStatus(
        "YouTube Player API is still loading. Please wait a moment and try again.",
        true
      );
      return;
    }

    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      setStatus("Please enter a valid YouTube video URL.", true);
      return;
    }
    currentVideoId = videoId;

    let segmentDurationSeconds;
    try {
      segmentDurationSeconds = parseHmsToSeconds(segmentStr);
    } catch (err) {
      setStatus(err.message || "Invalid segment duration.", true);
      return;
    }

    if (segmentDurationSeconds <= 0) {
      setStatus("Segment duration must be greater than 0 seconds.", true);
      return;
    }

    setStatus("Loading video and calculating duration…");
    player.cueVideoById(videoId);

    const maxWaitMs = 10000;
    const intervalMs = 400;
    let waited = 0;

    const timer = setInterval(() => {
      const duration = player.getDuration();
      if (duration && duration > 0) {
        clearInterval(timer);
        buildSegments({
          totalDuration: duration,
          baseUrl: videoUrl,
          segmentDurationSeconds,
          tbody: segmentsBody
        });

        // Persist latest state (all unchecked initially)
        localStorage.setItem(STORAGE_KEYS.url, videoUrl);
        localStorage.setItem(STORAGE_KEYS.duration, segmentStr);
        localStorage.setItem(STORAGE_KEYS.segments, segmentsBody.innerHTML);
        saveCompletionState(segmentsBody);

        setStatus(
          `Generated segments for video (${formatSeconds(duration)} total).`
        );
      } else {
        waited += intervalMs;
        if (waited >= maxWaitMs) {
          clearInterval(timer);
          setStatus(
            "Unable to read video duration. The video may be restricted or unavailable.",
            true
          );
        }
      }
    }, intervalMs);
  });

  // Play segment in player
  segmentsBody.addEventListener("click", (e) => {
    const link = e.target.closest(".segment-link");
    if (!link) return;

    e.preventDefault();
    const start = Number(link.dataset.start);
    const end = Number(link.dataset.end);

    if (!ytApiReady || !player || !currentVideoId) {
      setStatus("Player is not ready yet.", true);
      return;
    }

    if (overlay) overlay.style.display = "none";

    player.loadVideoById({
      videoId: currentVideoId,
      startSeconds: start,
      endSeconds: end
    });
  });

  // Persist checkbox changes
  segmentsBody.addEventListener("change", (e) => {
    if (!e.target.classList.contains("segment-check")) return;
    saveCompletionState(segmentsBody);
    localStorage.setItem(STORAGE_KEYS.segments, segmentsBody.innerHTML);
  });
});

// Helpers

function clearSegments(tbody) {
  tbody.innerHTML =
    '<tr><td colspan="5" class="segments-empty">No segments yet. Enter a video URL and duration, then click “Generate Segments”.</td></tr>';
}

function extractVideoId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      return u.pathname.slice(1) || null;
    }

    if (host === "youtube.com") {
      const v = u.searchParams.get("v");
      if (v) return v;

      const parts = u.pathname.split("/").filter(Boolean);
      const shortsIndex = parts.indexOf("shorts");
      if (shortsIndex !== -1 && parts[shortsIndex + 1]) {
        return parts[shortsIndex + 1];
      }

      const embedIndex = parts.indexOf("embed");
      if (embedIndex !== -1 && parts[embedIndex + 1]) {
        return parts[embedIndex + 1];
      }
    }

    return null;
  } catch {
    return null;
  }
}

function parseHmsToSeconds(str) {
  if (!str) throw new Error("Segment duration is required.");

  const cleaned = str.trim();
  const parts = cleaned.split(":").map((p) => p.trim());

  if (parts.some((p) => p === "" || isNaN(Number(p)))) {
    throw new Error("Use HH:MM:SS, MM:SS, or SS (numbers only).");
  }

  let seconds = 0;
  if (parts.length === 3) {
    const [h, m, s] = parts.map(Number);
    seconds = h * 3600 + m * 60 + s;
  } else if (parts.length === 2) {
    const [m, s] = parts.map(Number);
    seconds = m * 60 + s;
  } else if (parts.length === 1) {
    seconds = Number(parts[0]);
  } else {
    throw new Error("Invalid duration format.");
  }

  if (!isFinite(seconds) || seconds <= 0) {
    throw new Error("Segment duration must be greater than 0 seconds.");
  }

  return seconds;
}

function formatSeconds(secondsTotal) {
  const s = Math.floor(secondsTotal % 60);
  const m = Math.floor((secondsTotal / 60) % 60);
  const h = Math.floor(secondsTotal / 3600);

  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");

  return `${hh}:${mm}:${ss}`;
}

function buildSegments({
  totalDuration,
  baseUrl,
  segmentDurationSeconds,
  tbody
}) {
  const rows = [];
  let index = 1;

  for (let start = 0; start < totalDuration; start += segmentDurationSeconds) {
    const end = Math.min(start + segmentDurationSeconds, totalDuration);

    const startLabel = formatSeconds(start);
    const endLabel = formatSeconds(end);

    const segmentUrl = buildSegmentUrl(baseUrl, start);

    rows.push(
      `<tr>
        <td><input type="checkbox" class="segment-check" data-index="${index}" /></td>
        <td>${index}</td>
        <td>${startLabel}</td>
        <td>${endLabel}</td>
        <td>
          <a class="segment-link"
             href="${segmentUrl}"
             data-start="${Math.floor(start)}"
             data-end="${Math.floor(end)}">
             Play
          </a>
        </td>
      </tr>`
    );

    index += 1;
  }

  tbody.innerHTML = rows.join("");
}

// Save which checkboxes are checked
function saveCompletionState(tbody) {
  const checks = tbody.querySelectorAll(".segment-check");
  const completed = [];
  checks.forEach((cb) => {
    if (cb.checked) {
      completed.push(Number(cb.dataset.index));
    }
  });
  localStorage.setItem(STORAGE_KEYS.completed, JSON.stringify(completed));
}

// Reapply checked state based on saved data
function restoreCompletionState(tbody) {
  const raw = localStorage.getItem(STORAGE_KEYS.completed);
  if (!raw) return;
  let completed;
  try {
    completed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(completed)) return;

  const checks = tbody.querySelectorAll(".segment-check");
  checks.forEach((cb) => {
    const idx = Number(cb.dataset.index);
    if (completed.includes(idx)) {
      cb.checked = true;
    }
  });
}

function buildSegmentUrl(base, startSeconds) {
  let url;
  try {
    url = new URL(base);
  } catch {
    return base;
  }

  url.searchParams.delete("t");
  url.searchParams.set("t", String(Math.floor(startSeconds)));

  return url.toString();
}
