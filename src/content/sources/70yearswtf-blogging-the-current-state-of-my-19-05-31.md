---
title: "Blogging, the current state of my practice"
collection: "70YearsWTF"
kind: "post"
order: 0
date: "2019-05-31"
author: "Mike Wolf"
original_url: "https://70yearswtf.substack.com/p/blogging-the-current-state-of-my-19-05-31"
excerpt: "In this post, I am going to recap the current state of my blogging practice, and some improvements that I hope to make. This is a long, technical post, mainly for the benefit of Future Me, and the benefit of Present Me as I solved these…"
word_count: 1212
tags:
  - "70YearsWTF"
  - "70YearsWTF"
  - "blogging"
  - "automation"
related:
  - "70yearswtf-believe-not-what-is-true-but-what-19-05-15"
  - "70yearswtf-do-ideas-exist"
  - "70yearswtf-everything-is-an-idea"
  - "70yearswtf-everything-is-full-of-ideas"
  - "70yearswtf-i-am-an-idea-part-1-its-all-about"
---

In this post, I am going to recap the current state of my blogging practice, and some improvements that I hope to make.

This is a long, technical post, mainly for the benefit of Future Me, and the benefit of Present Me as I solved these problems.

## What I do now

Here’s the way things work right now.

### Open my tabs

I start by opening the tabs that I’m going to use for writing a particular post. I blogged about that [in this post](https://70yearsoldwtf.blogspot.com/2019/05/automating-autoblogger.html).

### Go through my checklist

My blog template contains a preflight checklist. It’s all the stuff that I ought to have completed before I start composing the blog’s content. In theory, I can march through the process without going around in circles, as I described in another post, written, but not published.

One pass through, and I am done.

The checklist is in Markdown format so that I can use this convention:

“`markdown

- [ ] this is unchecked
- [x] this is checked

`“

Which will render this way:

- [ ] this is unchecked
- [x] this is checked

### Enough intention

The first item on the checklist is to make sure I have enough [intention to finish the post.](https://70yearsoldwtf.blogspot.com/2019/03/decision-intention-prediction.html) The test at each step is: [do I predict that I will finish](https://70yearsoldwtf.blogspot.com/2018/10/predicting-this-post-and-other-plans.html).

### Clear picture

I need to make sure that I have a clear picture of the intended result. If it’s a long post (like this one) that means that I need to outline.

So do I have enough intention to outline?

Do I predict I will complete it?

### Research as needed

As I’m writing the outline, I do the research I need and drop links and quotes in the Google Doc.

I’ve got a research inventory stashed in [Dynalist](https://dynalist.io/), and [Onetab](http://v/), and [Pinboard](http://pinboard.in/) and [Evernote.](https://evernote.com/)

During the research and composition phases, I can use a Chrome extension called [TabCopy](https://chrome.google.com/webstore/detail/tabcopy/micdllihgoppmejpecmkilggmaagfdmb). It creates formatted links in the clipboard. I can choose to do it for the current tab, selected tabs, or all the tabs in the current window.

Then I paste them into the Google Doc.

If I want to clip some texts, with a reference back to the original URL, I can use the Dynalist Chrome extension, which will give me a linked quote like this:

> Maybe there’s a connection. Perhaps not. But right now I’m going with maybe there is.
> From [70 Years Old. WTF!: Search results for predictive processing](https://70yearsoldwtf.blogspot.com/search?q=predictive+processing)

There are parts of this process I can automate later.

### Compose in Docs

Now it’s time to compose the content in a Google Docs, using voice typing. Like I’m doing right now. Or was then.

As I complete each section, I’d like to review it and make sure I’m on track quickly. I haven’t yet developed the habit of doing that.

The check-in process will come later.

### Clean up in StackEdit

Once my draft is complete, I copy/paste the entire Google Docs content into [StackEdit](https://stackedit.io/).

StackEdit turns links in Google Docs into Markdown, using the format:
`“

[text to appear](http://place%20to%20link%20to/)

`“
Now everything is in plain text, and I can edit it in Grammarly.

I had been using the Chrome extension [Copy as MarkDown](https://chrome.google.com/webstore/detail/copy-as-markdown/fkeaekngjflipcockcnpobkpbbfbhmdn) to give me tab links in Markdown format, but StackEdit will convert the content that TabCopy puts on the clipboard.

### Clean up YouTube links

YouTube links look like this when captured with TabCopy

`“ [An interesting video](https://www.youtube.com/watch?v=ESNRgaCkiUA&t=756s)`“
They won’t render on the page. To do that I need to use the magic number at the `v=` parameter in an `embed` embed URL in an iframe, like this:

```

```

```
### Check in GrammarlyOnce I’ve got a clean post in StackEdit, I copy/paste the source into [Grammarly](https://grammarly.com) for spelling and grammar checking.### Another check in StackEditIn case I screw up some of the Markdown while editing in Grammarly, I can copy back into StackEdit for a quick visual check.### Into bloggerNext, I copy/paste the content into the Blogger new post tab.Once it’s there I do this:1.  Set the title (and remove from the document)2.  Set the tags (and remove from the document)3.  Render as markdown using [Markdown Here](https://markdown-here.com/)4.  (Optional) Schedule the postAnd finally...5.  Click Publish## Some other bits### ScreenshotsTo capture part of a screen, I used to have to crank up a Chrome Extension ([Nimbus Screenshot](https://nimbusweb.me/) for example).  After I’ve selected the area that I want, I download it. Then upload it to a shared folderOn my Google Pixel, I can use my Pixel Pen to capture the area that I want. I highlight the area and automatically downloads it to my Downloads folder.Now I can upload it to my Blog Images Google Photos Album. [A link to it is here](https://photos.google.com/album/AF1QipOV8cTgthOV571-2hmuRzG74MFX9HJT2-Ad489D).There’s probably an API for that. Later.### Blog photosTo get the URL for a Google photo, I go to the Blog Posts folder, and click on the image I want and open it in the browser. The URL in the omnibar is NOT the one to use. Instead, right-click the image and choose “Copy image URL.”If you put a photo in a Google Doc using Insert -> Image -> By URL and then use that URL. When you copy/paste the Doc contents into StackEdit, StackEdit will convert it to Markdown format:```markdown
```

with the text blank.

You can also paste an image URL into StackEdit using ctrl-shift-g. If you select some text, then that text will be used as the image alt-text:

```

```

### Modified image format

You can do that according to the rules in this post[enter link description here](https://sites.google.com/site/picasaresources/Home/Picasa-FAQ/google-photos-1/how-to/how-to-get-a-direct-link-to-an-image).

### Copying to blog photos folder in drive

I set up links between the Download folder and Google Drive Blog Post folder:

```
ln -s /mnt/chromeos/GoogleDrive/MyDrive/Media/Blog\ Photos/ blogphotosln -s /mnt/chromeos/MyFiles/Downloads/ downloads
```

So from the Linux shell, I can copy files. For whatever that’s worth.

### Blogus interruptus

If I can’t finish a post in one session, I’d like to preserve the tabs without cluttering up my browser. So I can use the OneTab extension to save all the tabs, and then later restore them all at once.

## What happens next

Here are some things I want to add to the project—in no particular order:

- Open windows for transcriptions
- Combined editing tool with
- Voice typing (with correction of words like quote/endquote and so on
- StackEdit (JS library)
- Grammarly
- Programmatic replacement of common spellings
- Timeboxing and time notifications
