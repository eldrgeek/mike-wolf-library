---
title: "Implementing a better chair in the sky"
collection: "70YearsWTF"
kind: "post"
order: 0
date: "2018-11-12"
author: "Mike Wolf"
original_url: "https://70yearswtf.substack.com/p/implementing-a-better-chair-in-the-18-11-12"
excerpt: "After I wrote the first draft of [my ranty blog post on how it is to be in an uncomfortable chair in the sky](https://70yearsoldwtf.blogspot.com/2018/11/when-your-chair-in-sky-is-just-not.html), I decided to actually try and do something…"
word_count: 1077
tags:
  - "70YearsWTF"
  - "- \"70YearsWTF"
related:
  - "70yearswtf-a-series-of-strokes-19-03-11"
  - "70yearswtf-what-problem-are-you-trying-to-solve-18-11-13"
  - "70yearswtf-when-your-chair-in-the-sky-is-just-18-11-11"
  - "70yearswtf-yesterdays-waste-of-time-18-11-13"
  - "70yearswtf-believe-not-what-is-true-but-what-19-05-15"
---

After I wrote the first draft of [my ranty blog post on how it is to be in an uncomfortable chair in the sky](https://70yearsoldwtf.blogspot.com/2018/11/when-your-chair-in-sky-is-just-not.html), I decided to actually try and do something about it. What a surprise! Me, doing something based on a plan.

And after a night’s sleep, I see how this thing might be scaled up and turned into a crowdcoded project. Which is pretty exciting! But that’s another post. For now let me focus. What a surprise! Me, focusd.

My starting point is to have it be like Google Docs with Voice Typing, only voice typing that I controlled. Chrome has a speech recognition API and a speech synthesis API. And I am a programmer who knows how to do this kind of shit

stuff. So why not check it out. What a surprise!

I went to one of my favorite development sites, [glitch](https://glitch.com/), and set up [a project](https://glitch.com/~eldr-voice-interface). Then stole
used some code that I found in a couple of places with tutorials on the API and put together a proof of concept for what I wanted. [You can see it running here](https://eldr-voice-interface.glitch.me/). It works on Chrome on desktop and on Android and might work on other browsers, but I don’t give a fuck care, because I only use Chrome. If you click on the black dot (which is supposed to be a microphone icon but may not be, then it will start listening and capture what you say. When you hear a short beep, it stops listening. I can make it restart, and might, but the time you see this. I also tested synthesis so it says back what you’ve typed.

I learned a lot about the speech API doing this little project. And I’ll document it in another blog post. Or maybe in the code. Who the fuck knows.

There seems to be a trick how the recognition and synthesis APIs work. You have to turn off speech recognition when you turn on the speech synthesis, otherwise, you get a feedback loop. It’s like the computer is playing telephone with itself. Sometimes it says the same thing over and over again, and sometimes it changes on iterations until it converges.

So I’ve got the proof of concept out of the way, and I’m ready to build the thing. I was going to call it AutoMike, but after a night’s sleep, I think I’m onto a product idea with more general use. So AutoMike is an example of a really personalized personal assistant—an AutoMe, and the process of building one’s own AutoMe I’m going to call AutoMetion. And that might be the name of the company.

AutoMike is always listening. When it finishes recognizing a text segment, it beeps gently.

How does it beep? Well, I found a [website with a tutorial on the audio inteface](https://odino.org/emit-a-beeping-sound-with-javascript/) that pointed me to the [AudioContext API](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext) and with a little ingenuity, I had beeps.

So an utterance between two beeps might be a command. (Or it might be able to use other cues to let me know when it should interpret an utterance as a command.)

I’m imagining all kinds of things it could do, see random ideas at the end. But for now, let’s imagine how I’d write a blog post with AutoMike.

In its fully fleshed-out version I might say: “New Blog Post.” AutoMike asks: “Which Blog?” and tries to match what I answer to a blog that I’ve told it about (we’ll come how I’ve told it in a bit.) If I say a “Blog post in AutoMike will try to make the match. If it can’t match, it will respond with the name that it’s captured and tell me that it doesn’t know what the fuck I am talking about a blog by that name.

(Google has something called DialogFlow, that can be used to create conversational dialogues. The first level of this proposed tool might be done with DialogFlow. But to start with, I’m going to do this low-level, using Google Speech API.)

The names of blogs and the commands that AutoMike understands would be in a configuration file. To change the configuration file I can say: “edit configuration.” AutoMike will suspend what it’s currently doing (and remember what it was doing,) and let me edit its configuration. Its configuration is the JSON file, that defines AutoMike’s behavior.

But for now, the configuration will be wired into AutoMIke’s code, and there’s only one blog post to edit and by default, anything you say is appended to that post. One thing at a time.

Auto Mike has modes. A mode might be entered by “start ” and exited (to command mode) by “end ” So to do dictation, it’s “start dictation” and “end dictation.”

Right now I’ll define the following modes: command mode, dictation, edit. So a session might look something like this:

```
“start dictation”> “Starting dictation”_“start edit”  >“Starting edit”“end edit”  >“Ending edit. Continuing dictation”“end dictation.”  >“Ending dictation. What’s next?”  “start posting”  >“Posting. Which blog?”  And so on.
```

I’ve partly worked out the problem of posting using Google’s API for bloggers in another project.

Editing would be done in a CodeMirror editor, which a combination of spoken commands and typing.

I’d have a way to tell it to switch to markdown and back.

I’m thinking that I would build this tool as a set of microservices. Each one will operate independently. There needs to be some communication protocol between or among them and possibly an executive function. I’ll figure that out later.

Another tool would clean up the raw text. The configuration for that tool will have a bunch of respellings like “Bobbi” for “Bobby” and maybe some regex respellings to handle stuff like `/^\s_quote(._?)\s_end quote\s_$/ -> ‘”$1”’`

That’s the start of AutoMe, initially, just for blogging, but there are lots of other things I’d like to use it for. Because there’s a lot of me to automate.
