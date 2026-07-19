/**
 * Tumblr Boombox Script (v2)
 * Original by Robin (github @robinpx) — rebuilt on Tumblr API v2
 * because API v1 and the whateverorigin CORS proxy this depended
 * on both stopped working.
 *
 * Requires a free Tumblr OAuth Consumer Key: https://www.tumblr.com/oauth/apps
 * Drop it into TUMBLR_API_KEY below.
 *
 * Notes on what changed vs the original:
 * - Data source is now https://api.tumblr.com/v2/blog/{blog}/posts (NPF format),
 *   which is the current supported public read API.
 * - Bandcamp and Spotify posts are no longer scraped for a direct stream URL
 *   (that relied on a dead free CORS proxy scraping fragile page markup).
 *   Those tracks show up in the list with a "Listen on original post" link
 *   instead of inline playback.
 * - Native Tumblr-hosted audio and SoundCloud embeds still play inline.
 * - All playback UI (play/pause/next/prev/shuffle/repeat/progress bar/
 *   error-skip/day-night mode/tag filter/host filter) is unchanged from
 *   the original — that part never depended on the dead APIs.
 **/
const boombox = function() {

const TUMBLR_API_KEY = "Krqtd7WYuQoytieE87n7ZkgqKw0UvLMubWIYsxFIamAk0WW9xF";

let audioFiles = [];
let postURLs = [];
let unplayable = []; // true = no inline stream available, show link only

let linkOfWindow = window.location.href;
let params = new URLSearchParams(linkOfWindow.split("?").slice(1).join("?").replace(/\?/g, "&"));
let username = params.get("username") || "";
let tagged = params.get("tag") || "";

let count = -1;
let nextOffset = 0;
let pageSize = 20;
let totalPosts = 0;
let numOfSongs = 0;
let index = 0;

let repeatBool = false;
let shuffleBool = false;

let current = "";
let timer;
let trackCache = "";

/**
 * Builds a Tumblr API v2 URL for fetching audio-type posts.
 **/
function apiUrl(offset) {
    let url = "https://api.tumblr.com/v2/blog/" + encodeURIComponent(username) + ".tumblr.com/posts"
        + "?api_key=" + encodeURIComponent(TUMBLR_API_KEY)
        + "&type=audio"
        + "&npf=true"
        + "&limit=" + pageSize
        + "&offset=" + offset;
    if (tagged.length > 0) {
        url += "&tag=" + encodeURIComponent(tagged.replace(/\+/g, " "));
    }
    return url;
}

/**
 * Kicks off the first fetch if a username is present.
 **/
function start() {
    if (!username) {
        setBoombox();
        return;
    }
    if (!TUMBLR_API_KEY || TUMBLR_API_KEY === "YOUR_TUMBLR_API_KEY_HERE") {
        $("#tracks").append("<div class='lin'>Missing Tumblr API key. Add your OAuth Consumer Key to TUMBLR_API_KEY in script.js — get one free at <a href='https://www.tumblr.com/oauth/apps' target='_blank'>tumblr.com/oauth/apps</a>.</div>");
        return;
    }
    fetchPage(0);
}

/**
 * Fetches one page of audio posts from Tumblr API v2 and processes them.
 **/
function fetchPage(offset) {
    fetch(apiUrl(offset))
        .then(function(res) {
            if (!res.ok) {
                throw new Error("Tumblr API returned " + res.status);
            }
            return res.json();
        })
        .then(function(data) {
            if (!data || !data.response) {
                throw new Error("Unexpected API response");
            }
            let response = data.response;
            let posts = response.posts || (response.blog ? response.posts : response) || [];
            totalPosts = response.total_posts !== undefined ? response.total_posts : posts.length;

            if (offset === 0) {
                if (totalPosts === 0 || !posts || posts.length === 0) {
                    $("#loadmore").remove();
                    $("#tracks").append("<div class='lin'>Oh... there aren't any tunes on Tumblr user <a href='https://" + username + ".tumblr.com'>" + username + "</a>'s account" + (tagged ? " tagged <a href='https://" + username + ".tumblr.com/tagged/" + encodeURIComponent(tagged) + "'>#" + tagged + "</a>" : "") + ".</div>");
                    return;
                }
                $("#currentUser").append("<a href='https://" + username + ".tumblr.com'>" + username + "</a>");
            }

            processPosts(posts);

            nextOffset = offset + posts.length;
            $("#loadmore").remove();
            if (nextOffset < totalPosts && posts.length > 0) {
                $("#tracks").append("<div id='loadmore' class='lin' onClick='boombox.loadMore()'>Load more</div>");
            }

            $("#tracks").prepend(trackCache);
            trackCache = $("#tracks .tune").detach();
            filter();

            if (offset === 0) {
                init();
            }
        })
        .catch(function(err) {
            console.log(err);
            if (offset === 0) {
                $("#tracks").append("<div class='lin'>Couldn't load tunes for <a href='https://" + username + ".tumblr.com'>" + username + "</a> — the blog may not exist, may be private, or the Tumblr API may be unavailable right now.</div>");
            }
        });
}

/**
 * Walks NPF post content blocks looking for an audio block or a
 * SoundCloud/Bandcamp/Spotify iframe embed, and appends a track entry.
 **/
function processPosts(posts) {
    posts.forEach(function(post) {
        let track = "Unknown";
        let artist = "Unknown";
        let postURL = post.post_url || ("https://" + username + ".tumblr.com");
        let found = false;
        let host = "tumblr";
        let src = null;
        let playable = true;

        let blocks = post.content || [];
        // Also check trail/reblog content as a fallback for audio reblogged with no new content.
        if (blocks.length === 0 && post.trail && post.trail.length > 0) {
            blocks = post.trail[post.trail.length - 1].content || [];
        }

        for (let i = 0; i < blocks.length; i++) {
            let block = blocks[i];
            if (block.type === "audio") {
                found = true;
                host = "tumblr";
                if (block.media && block.media.url) {
                    src = block.media.url;
                    playable = true;
                } else if (block.url) {
                    // External audio URL (e.g. soundcloud/spotify link) with no direct media.
                    src = block.url;
                    playable = /\.(mp3|m4a|ogg|wav)(\?|$)/i.test(block.url);
                    if (!playable) {
                        if (/soundcloud/i.test(block.url)) host = "soundcloud";
                        else if (/spotify/i.test(block.url)) host = "spotify";
                        else if (/bandcamp/i.test(block.url)) host = "bandcamp";
                    }
                }
                track = block.title || track;
                artist = block.artist || artist;
                break;
            }
        }

        if (!found) return; // not actually an audio block we can use

        count++;
        appendTracks(track, artist, host);
        postURLs[count] = postURL;
        unplayable[count] = !playable || !src;
        audioFiles[count] = playable && src ? src : null;
    });
}

function appendTracks(track, artist, type) {
    if (track === undefined || track === null || track === "") track = "Unknown";
    if (artist === undefined || artist === null || artist === "") artist = "Unknown";
    $("#tracks").append("<div class='" + type + " lin song-" + count + " tune'><div class='track'><svg version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' width='1.4em' height='1.2em' viewBox='0 0 30 32'><g id='icomoon-ignore'></g><path d='M13.652 5.265l-7.696 6.134h-5.955v4.748l-0.003 0.003 0.003 0.003v4.698h5.987l7.664 6.015v-6.015h0.001v-9.451h-0.001z' fill='#000000'></path><path d='M16.105 10.726c1.142 1.522 1.746 3.336 1.746 5.246 0 1.95-0.627 3.795-1.813 5.335l0.832 0.641c1.329-1.726 2.032-3.792 2.032-5.976 0-2.139-0.677-4.171-1.957-5.877l-0.84 0.631z' fill='#000000'></path><path d='M20.336 6.919l-0.809 0.669c1.973 2.389 3.059 5.416 3.059 8.521 0 3.069-1.009 5.956-2.919 8.348l0.82 0.655c2.060-2.58 3.148-5.693 3.148-9.003-0-3.349-1.172-6.613-3.3-9.19z' fill='#000000'></path><path d='M23.606 3.51l-0.789 0.694c2.896 3.289 4.492 7.518 4.492 11.909 0 4.302-1.539 8.467-4.335 11.727l0.798 0.683c2.957-3.45 4.587-7.858 4.587-12.41 0-4.647-1.688-9.123-4.753-12.603z' fill='#000000'></path></svg>" + track + "</div><div class='artist'>" + artist + "</div></div>");
}

/**
 * Sets up the boombox and adds click method to play and pause buttons.
 **/
function init() {
    numOfSongs = audioFiles.length;
    index = 0;
    // start on the first actually-playable track if track 0 has no stream
    while (index < numOfSongs && unplayable[index]) index++;
    if (index >= numOfSongs) index = 0;
    current = "song-" + index;
    setPlayer();
    $("." + current).addClass("highlight");
    setBoombox();
    $("#pause").hide();

    $("#pause").off("click").on("click", function() {
        document.getElementById(current).pause();
        $("#play").show();
        $(this).hide();
    });

    $("#play").off("click").on("click", function() {
        if (unplayable[index]) {
            nextSong();
            return;
        }
        $("audio").unbind("ended", endedSong);
        $("audio").bind("ended", endedSong);
        checkError();
        document.getElementById(current).ontimeupdate = function() { updateProgress(); };
        document.getElementById(current).play();
        $("#pause").show();
        $(this).hide();
    });
}

function setBoombox() {
    if (!username) {
        $("#tracks").append("<div class='lin'>Welcome! Please enter a Tumblr username to begin listening.</div>");
        $("#menuinfo .wrap:nth-child(2), #menuinfo .wrap:last-child").hide();
        return;
    }
    else if ($(".highlight .track").html() !== null) {
        $("#defined").fadeIn();
        changeCurrentSong();
    }
}

function setSongClass(direction) {
    if (direction === "next") {
        if ($("#tracks").find(".tune").length - $("." + current).index() <= 1) {
            current = $(".tune").first().attr("class");
        } else {
            current = $("." + current).next().attr("class");
        }
    } else if (direction === "prev") {
        if ($("." + current).prev().length === 0) {
            current = $(".tune").last().attr("class");
        } else {
            current = $("." + current).prev().attr("class");
        }
    }
    current = current.substring(current.indexOf("song-"), current.indexOf(" tune"));
    index = current.substring(current.indexOf("song-") + 5, current.length);
}

function nextSong() {
    exitSong();
    setSongClass("next");
    enterSong();
}

function prevSong() {
    exitSong();
    setSongClass("prev");
    enterSong();
}

function repeatSong() {
    document.getElementById(current).currentTime = 0;
    document.getElementById(current).pause();
    document.getElementById(current).ontimeupdate = function() { updateProgress(); };
    document.getElementById(current).play();
}

function shuffleSong() {
    exitSong();
    index = Math.floor(Math.random() * ($(".tune").length - 1));
    current = "song-" + index;
    enterSong();
}

function pressedSong() {
    let className = $(this).attr("class");
    let songIndex = className.indexOf("song-");
    let songNum = className.substring(songIndex + 5, className.length);
    songNum = parseInt(songNum);
    exitSong();
    index = songNum;
    current = "song-" + index;
    enterSong();
}

function endedSong() {
    if (repeatBool === true) repeatSong();
    else if (shuffleBool === true) shuffleSong();
    else nextSong();
}

function exitSong() {
    window.clearTimeout(timer);
    let el = document.getElementById(current);
    if (el) {
        el.currentTime = 0;
        el.pause();
    }
    $("." + current).removeClass("highlight");
    $("#play").show();
    $("#pause").hide();
}

function enterSong() {
    setPlayer();
    if (unplayable[index]) {
        $("." + current).addClass("highlight");
        changeCurrentSong();
        $("#play").show();
        $("#pause").hide();
        return;
    }
    document.getElementById(current).ontimeupdate = function() { updateProgress(); };
    document.getElementById(current).play();
    $("." + current).addClass("highlight");
    $("#pause").show();
    $("#play").hide();
    checkError();
    changeCurrentSong();
}

function setPlayer() {
    document.getElementById("currenttime").innerHTML = "00:00";
    document.getElementById("currentdura").innerHTML = "00:00";
    $("#progress").css({ width: "0px" });
    $("#loading").css({ width: "0px" });
    $("audio").attr("id", current);
    $("audio").attr("src", audioFiles[index] || "");
    $("audio").unbind("ended", endedSong);
    $("audio").bind("ended", endedSong);
}

function changeCurrentSong() {
    let currentTrack = $(".highlight .track").html();
    let currentArtist = $(".highlight .artist").html();
    $("#currentTrack").empty().append(currentTrack);
    if (currentArtist !== "Unknown") {
        $("#by").show();
        $("#currentArtist").empty().append(currentArtist);
    } else {
        $("#by").hide();
        $("#currentArtist").empty();
    }
    let linkText = unplayable[index] ? "Listen on original post" : "Go to post";
    $("#currentPost").empty().append("<a href='" + postURLs[index] + "' target='_blank'>" + linkText + "</a>");
}

function checkError() {
    $("." + current).removeClass("error");
    timer = window.setTimeout(function() {
        let el = document.getElementById(current);
        if (!el) return;
        let time = el.currentTime;
        let dura = el.duration;
        if (time === 0 && isNaN(dura)) {
            $("." + current).addClass("error");
            nextSong();
        }
    }, 15000);
}

function updateProgress() {
    let el = document.getElementById(current);
    if (!el) return;
    let time = el.currentTime;
    let dura = el.duration;
    let loadbar = el.buffered.length > 0 ? el.buffered.end(0) : 0;
    let wid = document.getElementById("progressbg").offsetWidth;
    document.getElementById("currenttime").innerHTML = formatTime(time);
    document.getElementById("currentdura").innerHTML = formatTime(dura);
    let prog = wid * (time / dura);
    let load = wid * (loadbar / dura);
    $("#progress").animate({ width: prog + "px" }, 1);
    $("#loading").animate({ width: load + "px" }, 1);
}

function formatTime(seconds) {
    let min = Math.floor(seconds / 60);
    let sec = Math.floor(seconds % 60);
    if (isNaN(min) || isNaN(sec)) { min = "0"; sec = "0"; }
    if (min < 10) min = "0" + min;
    if (sec < 10) sec = "0" + sec;
    return min + ":" + sec;
}

function loadMore() {
    $("#loadmore").remove();
    fetchPage(nextOffset);
}

function shiftProgress(elem, e) {
    let pageX = e.pageX;
    let left = elem.offset().left;
    let el = document.getElementById(current);
    let dura = el ? el.duration : NaN;
    let width = document.getElementById("progressbg").offsetWidth;
    let position = pageX - left;
    if (!isNaN(dura) && el) {
        let newTime = (position * dura) / width;
        el.currentTime = newTime;
        $("#progress").css({ width: position + "px" });
    }
}

function getFirstAudioFile() {
    return audioFiles[0] || "";
}

function getUsername() { return username; }
function getRepeatBool() { return repeatBool; }
function getShuffleBool() { return shuffleBool; }
function setShuffleBool(b) { shuffleBool = b; }
function setRepeatBool(b) { repeatBool = b; }
function getIndex() { return index; }

function filter() {
    $("#tracks").prepend(trackCache);
    $(".filterout").each(function() {
        let filterout = $(this).attr("id");
        $("." + filterout).remove();
    });
    $(".tune").unbind("click", pressedSong);
    $(".tune").bind("click", pressedSong);
}

function setFilter() {
    exitSong();
    filter();
    $("#tracks .tune").removeClass("highlight");
    let first = $(".tune").first().attr("class");
    if (!first) return;
    current = first;
    current = current.substring(current.indexOf("song-"), current.indexOf(" tune"));
    index = current.substring(current.indexOf("song-") + 5, current.length);
    enterSong();
    $("#pause").trigger("click");
}

function getNumofHosts() {
    let sum = 0;
    if ($(".tune").hasClass("tumblr")) sum += 1;
    if ($(".tune").hasClass("soundcloud")) sum += 1;
    if ($(".tune").hasClass("bandcamp")) sum += 1;
    if ($(".tune").hasClass("spotify")) sum += 1;
    return sum;
}

return {
    start: start,
    init: init,
    getIndex: getIndex,
    setRepeatBool: setRepeatBool,
    getRepeatBool: getRepeatBool,
    setShuffleBool: setShuffleBool,
    getShuffleBool: getShuffleBool,
    shiftProgress: shiftProgress,
    getFirstAudioFile: getFirstAudioFile,
    getUsername: getUsername,
    nextSong: nextSong,
    prevSong: prevSong,
    repeatSong: repeatSong,
    shuffleSong: shuffleSong,
    getNumofHosts: getNumofHosts,
    setFilter: setFilter,
    loadMore: loadMore
};

}();

window.onload = function() {
    $("#next").click(function() {
        if (boombox.getRepeatBool() === true) boombox.repeatSong();
        else if (boombox.getShuffleBool() === true) boombox.shuffleSong();
        else boombox.nextSong();
    });

    $("#prev").click(function() {
        if (boombox.getRepeatBool() === true) boombox.repeatSong();
        else if (boombox.getShuffleBool() === true) boombox.shuffleSong();
        else boombox.prevSong();
    });

    $("#player").append("<audio class='aud' preload='auto' id='song-0' controls></audio>");
    boombox.start();
};

$(document).ready(function() {
    if (typeof(Storage) !== "undefined") {
        if (localStorage.mode === "on") {
            $("body").addClass("bodyfilter");
            $("#infobar, #tracks, #labels, #playerbar").addClass("filtered");
            $("#day").show();
            $("#night").hide();
        }
    }

    $("#pause").hide();
    $("#buttons").fadeTo(600, 1);

    function goToUsername(event) {
        if (event) event.preventDefault();
        let value = $("#usernamebar").find("input:first").val().trim();
        if (value.length === 0) return;
        location.replace("?username=" + encodeURIComponent(value));
    }

    function goToTag(event) {
        if (event) event.preventDefault();
        let value = $("#tagbar").find("input:first").val().trim();
        if (value.length === 0) return;
        location.replace("?username=" + encodeURIComponent(boombox.getUsername()) + "&tag=" + encodeURIComponent(value));
    }

    // Real submit event (covers clicking the Go button and pressing Enter
    // in browsers where implicit form submission fires reliably).
    $("#usernamebar").on("submit", goToUsername);
    $("#tagbar").on("submit", goToTag);

    // Belt-and-suspenders: also listen directly for Enter on the inputs
    // and for a click on the Go buttons, so this doesn't depend on the
    // browser's native implicit-submit behavior at all.
    $("#usernamebar input").on("keydown", function(event) {
        if (event.key === "Enter" || event.keyCode === 13) goToUsername(event);
    });
    $("#usernamebar .go-btn").on("click", goToUsername);

    $("#tagbar input").on("keydown", function(event) {
        if (event.key === "Enter" || event.keyCode === 13) goToTag(event);
    });
    $("#tagbar .go-btn").on("click", goToTag);

    $(".filtertype").click(function() {
        let hosts = boombox.getNumofHosts();
        let filtered = $(".filterout").length;
        if (!(hosts < filtered) && hosts > 1) {
            $(this).toggleClass("filterout");
        } else {
            $(this).removeClass("filterout");
        }
        boombox.setFilter();
    });

    $("#repeat").click(function() {
        if ($(this).hasClass("on")) {
            boombox.setRepeatBool(false);
            $(this).removeClass("on");
        } else {
            boombox.setRepeatBool(true);
            $(this).addClass("on");
        }
    });

    $("#shuffle").click(function() {
        if ($(this).hasClass("on")) {
            boombox.setShuffleBool(false);
            $(this).removeClass("on");
        } else {
            boombox.setShuffleBool(true);
            $(this).addClass("on");
        }
    });

    $("#progressbg, #loading, #progress").click(function(e) {
        boombox.shiftProgress($(this), e);
    });

    $("#open").click(function() {
        $("#menuwrap").fadeIn();
        $("#open").hide();
        $("#close").show();
    });

    $("#close").click(function() {
        $("#open").show();
        $("#close").hide();
        $("#menuwrap").fadeOut();
    });

    $("#mode").click(function() {
        if (!$("body").hasClass("bodyfilter")) {
            $("body").addClass("bodyfilter");
            $("#infobar, #tracks, #labels, #playerbar").addClass("filtered");
            $("#day").show();
            $("#night").hide();
            localStorage.mode = "on";
        } else {
            $("body").removeClass("bodyfilter");
            $("#infobar, #tracks, #labels, #playerbar").removeClass("filtered");
            $("#night").show();
            $("#day").hide();
            localStorage.mode = "off";
        }
    });

    $("#currently").click(function() {
        $("#more").show();
        $(this).hide();
    });

    $("#seeCurrent").click(function() {
        $("#currently").show();
        $("#more").hide();
    });

    $("#scrollTo").click(function() {
        let winWidth = $(window).width();
        let elem, scr = null;
        scr = "+=" + ($(".highlight").first().offset().top - 45);
        if (winWidth >= 815) {
            elem = $("#tracks");
        } else {
            elem = $("body, html");
            scr = ($(".highlight").first().offset().top - 65);
        }
        elem.animate({ scrollTop: scr }, 500);
    });

    function jumpToSong() {
        let winWidth = $(window).width();
        if (winWidth < 875) {
            let triggerScroll = 1000;
            let toSong = function() {
                let scroll = $(window).scrollTop();
                if (scroll > triggerScroll) $("#note").fadeIn();
                else $("#note").fadeOut();
            };
            toSong();
            $(window).on("scroll", function() { toSong(); });
            $("#note").click(function() {
                $("html, body").animate({ scrollTop: ($(".highlight").first().offset().top - 65) }, 550);
                return false;
            });
        }
    }
    jumpToSong();
});
