---
title: "An Evernote Alternative"
collection: "70YearsWTF"
kind: "post"
order: 0
date: "2017-11-13"
author: "Mike Wolf"
original_url: "https://70yearswtf.substack.com/p/an-evernote-alternative-17-11-13"
excerpt: "In [this post](https://70yearsoldwtf.blogspot.com/2017/11/my-evernote-blogging-notebook.html), I talked about my use of Evernote and my desire for an alternative. Here I'm going to riff about the way I'd like my alternative to work and…"
word_count: 916
tags:
  - "70YearsWTF"
  - "- \"70YearsWTF"
related:
  - "70yearswtf-believe-not-what-is-true-but-what-19-05-15"
  - "70yearswtf-do-ideas-exist"
  - "70yearswtf-everything-is-an-idea"
  - "70yearswtf-everything-is-full-of-ideas"
  - "70yearswtf-i-am-an-idea-part-1-its-all-about"
---

In [this post](https://70yearsoldwtf.blogspot.com/2017/11/my-evernote-blogging-notebook.html), I talked about my use of Evernote and my desire for an alternative.

Here I'm going to riff about the way I'd like my alternative to work and maybe a little about how I plan to attack the problem.

There are two subproblems: on desktop machines and on mobile. For desktop machines, I'll consider Chrome. For mobile, Android.

My current Chrome workflow starts with either a search or a post on a social media site that leads me to an interesting initial page. As I'm reading, I may control-click to open linked pages in new tabs and let the new pages load in the background. Depending on the content I may continue through the initial page, move from the initial page to one or more linked page, or move back and forth. From a linked page, I may open more pages. The path that I've taken to get to a page that I decided to clip is useful, and that information is currently lost.

When I find something sufficiently interesting, I use the Evernote Web Clipper to capture what I want, but there are problems. It's got a hotkey, but I usually click on the icon to start the clipping option. It brings up a dialog that lets me make some clipping options: for example, clip the whole page, clip the contents (don't use the full CSS, but simplify it), clip a selection, choose tag and notebook. If I've selected some text, it highlights the text. If I haven't, it moves the page back to the start and shows me what I'm going to clip. It also lets me decide what notebook to use (it tries to guess) and what tags to use. It also has a Save button.

I can change these, but usuallyI don't. When I click Save, it starts clipping. Once that happens, the clipper blocks navigation on that page. So I don't clip a page as soon as I decide it's worth clipping because would stop me from continuing to read it. Instead, I wait until I've read it, or until I've decided to switch tabs. The clipper works in the background, but sometimes it's really slow. If I clip the same page several times I end up with several copies rather than one copy with a reference count.

The current mode of operation is:

1. I initiate the action
2. A dialog appears so I can change the action
3. I click Save to cause the operation to proceed
4. When the operation is finished, I dismiss the dialog

Instead, I'd like it to happen this way:

1. I initiate the action
2. It starts, in the background.
3. It briefly displays something that tells me what it's doing
4. I can dismiss the dialog or interrupt it and change

All clipping happens in the background. First information is moved to local storage, then from local storage to the cloud. Once information is backed up to the cloud it's removed from local storage. If the backup operation is interrupted, say by closing my laptop cover or disconnecting, it continues when I've got connectivity. If I try to close a tab or window while backing up to local storage, I get a warning dialog--or just a delay.

I'd like to be able to tell my clipper to do things in all of the following ways:

- Press a hotkey or an icon to start an operation
- If something is selected, then it's implicitly the text that is to be saved, otherwise, it's the page

The actions I can take are:

- ClipIf something is highlighted, clip the page and the highlighted part
- If nothing highlighted, clip the page if not already clipped

Unclip: if something has been clipped by default, remove the clip

Tag (or change tags) for a page or a highlighted part of a page

By default, whenever I tag a page or part of the page, any page I open from it inherits its tags.

Whenever I clip anything, I want the full path to the content saved along with the clip. For full page clips, it's the page URL, plus a reference to the link on the referring page (recursively, if necessary; I don't want to lose information on how I got to the clipped content). For search page links the reference might not be useful, but a quick check shows me that Google search result elements may have attributes (like data-ved) that may contain useful information.

For more-or-less static pages, the reference would be a CSS path to the referring link element.

When I clip highlighted sections I want to save a CSS selector that gets the element containing the high

If I clip several excerpts from a page--even in different sessions--I'd like to have them presented together.

Implementation:

Step 1 is to create a plugin, and solve the following problems:

- Inject a script into a page.
- The script will listen for a hotkeyGrab URL, page contents, and text if any selected
- Display an informative dialog and cause it to vanish after a delay
- Listen for other hotkeys during delaySuspend save and display an options dialog
- Cancel save
- Undo last operation

Save information

- URL
- Page contents
- Text if any has been highlighted
