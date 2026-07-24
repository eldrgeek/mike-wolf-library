---
title: "RSILT Feb 1"
collection: "70YearsWTF"
kind: "post"
order: 0
date: "2020-02-03"
author: "Mike Wolf"
original_url: "https://70yearswtf.substack.com/p/rsilt-feb-1-20-02-03"
excerpt: "Feb 1, I decided I was going to keep track of what I learned. Looking back I was surprised. Does that happen every day? I have another blog, called [Random Shit I learned today](https://rsilt.blogspot.com/). I’m cross posting there and…"
word_count: 1650
tags:
  - "70YearsWTF"
  - "70YearsWTF"
  - "AI"
  - "blogging"
  - "automation"
related:
  - "70yearswtf-holding-hands-with-the-unconscious-19-02-14"
  - "70yearswtf-more-advice-share-your-gifts"
  - "70yearswtf-postprocessing-4000-tabs-to-close-20-01-26"
  - "70yearswtf-believe-not-what-is-true-but-what-19-05-15"
  - "70yearswtf-do-ideas-exist"
---

Feb 1, I decided I was going to keep track of what I learned. Looking back I was surprised.

Does that happen every day?

I have another blog, called [Random Shit I learned today](https://rsilt.blogspot.com/). I’m cross posting there and I’ll post future ones there.

# Jack Kornfield

On my morning walk I listed to a conversation between [Sam Harris](https://samharris.org/about/) ([Wikipedia](https://en.wikipedia.org/wiki/Sam_Harris)) and [Jack Kornfield](https://jackkornfield.com/) ([Wikipedia](https://en.wikipedia.org/wiki/Jack_Kornfield)) on the [Waking Up](https://wakingup.com/) course about their experiences in practice.

I wrote a post about it: [70 Years Old. WTF!: Is that boulder heavy?](https://70yearsoldwtf.blogspot.com/2020/02/is-that-boulder-heavy.html)

## Random

Looked up [Super Bowl 2020: 49ers vs. Chiefs bold predictions, including Mahomes struggling and a fullback touchdown - CBSSports.com](https://www.cbssports.com/nfl/news/super-bowl-2020-49ers-vs-chiefs-bold-predictions-including-mahomes-struggling-and-a-fullback-touchdown/)

I got an email from someone I met at the library and remembered that someone had mentioned one of the teachers at GSA who was encouraging kids to get into PioneerPrize;
[Our School / Anya Antonovych](https://www.georgestevensacademy.org/Page/856)

Somewhere I found this product called Nexmo. What is it? Who knows?
[Nexmo Dashboard](https://dashboard.nexmo.com/sign-in)

## Pop up previews

I did some research about pop-up link previews [Show post excerpts with thumbnail on your blog](https://xomisse.com/blog/show-post-excerpts-with-thumbnail-on-blogger/)

These are used by Gwern and by Lesswrong. I’d lilke to have them on my blog.

## Trip to West Coast

Researched travel to the West Coast. In the AM considered stopping in Albuquerque
[Boston, MA to Albuquerque, NM - Google Maps](https://www.google.com/maps/dir/Boston,+MA/Albuquerque,+NM/@38.7094235,-97.8681731,5z/data=!3m1!4b1!4m14!4m13!1m5!1m1!1s0x89e3652d0d3d311b:0x787cbf240162e8a0!2m2!1d-71.0588801!2d42.3600825!1m5!1m1!1s0x87220addd309837b:0xc0d3f8ceb8d9f6fd!2m2!1d-106.650422!2d35.0843859!3e0)
[Salt Lake City, UT to Alameda, CA - Google Maps](https://www.google.com/maps/dir/Salt+Lake+City,+UT/Alameda,+CA/@40.760839,-111.9261527,13z/data=!4m14!4m13!1m5!1m1!1s0x87523d9488d131ed:0x5b53b7a0484d31ca!2m2!1d-111.8910474!2d40.7607793!1m5!1m1!1s0x808f80d8f2cf1595:0x66ff99cf60016f14!2m2!1d-122.2821855!2d37.7798721!3e0)

## Kaj Sotala

Kay Sotala is a finish AI researcher who has written some outstanding posts. I spent some timer reading his stuff,
[18-month follow-up on my self-concept work | Kaj Sotala](https://kajsotala.fi/2018/12/18-month-follow-up-on-my-self-concept-work/)

[Less Wrong posts | Kaj Sotala](https://kajsotala.fi/2012/07/less-wrong-posts/)

[The Brain as a Universal Learning Machine - LessWrong 2.0](https://www.lesswrong.com/posts/9Yc7Pp7szcjPgPsjf/the-brain-as-a-universal-learning-machine)

## Learning polish

A while back I read some stuff about learning language that said that learng the way kids learn was effective. You listen to the language spoken as someone reads a book and you get the meaning by reading the text in your native language. Somehow your brain puts the stream of sound together with the stream of meaning and you learn.

So I goit an audiobook version of first Harry Potter book in Polish and an eBook in English and set to it.

It kind-of worked, very slowly. Little by little my brain would decode a word or two. That word is “drill.” That one is “cape.” But progress was very slow.

I did another experiement where I played the audiobook and had the Google Translate App translate it in real time. That provided me with some more insight, but was very labor intensive.

Today I tried again.

I got a Polish eBook version, and found a way that I could call on Google Translate from a Google Sheets script. So the idea was: copy polish test into a spreadsheet. Break it down with each sentence in a cell in a column. Then use Google Translate to put the English tranlation in a cell in the next column.

Then I decided to write a script so that I could put the whole chapter in one cell and the script would turn it into a column of sentences with adjoining tranlations.

Then I decided to go one better: I’d build a webapp that took in the following:

1. An MP3 of the chapter read in Polish
2. Text of the chapter in Polish
3. A table with timestamps for the start of each sentence or phrase, and the offset in the text of the corresponding translation.

This could probably be automated, but it’s probably easier to just play the audio and have the user hit the space key at the start of each sentence. Or possibly the , to indicate the end of a phrase and . to indicate the end of a sentence.

Once i had that, I could play the audio and have either the Polish text or the English translation, or both pop up. Then add some controls to move back and forwarard, and I’ve got a pretty good tool.

So I learned:

1. Where I could copy/past the English text of a book from [Your Kindle highlights and notes are now easier to access](https://ebookfriendly.com/new-amazon-kindle-highlights-mobile-friendly/)
2. Where I could get a Polish text format for Harry Potter.
3. The text was in .epub format, so I also needed an ePub reader I found this one: [EPUBReader - Chrome Web Store](https://chrome.google.com/webstore/detail/epubreader/jhhclmfgfllimlhabjkgkeebkbiadflb?hl=en)
4. I needed a way to select a chapter in the ePub reader so that I could copy it and paste it into other tools.
5. I found this English to Polis pop-up translator: [Smart Translate – translator, dictionary - Chrome Web Store](https://chrome.google.com/webstore/detail/smart-translate-%E2%80%93-transla/pphomcihfhhacahhfjjkgglddckjohid)
6. I made an experimental Google Doc to work out my vision. [Harry Potter - Google Docs](https://docs.google.com/document/d/1xcW-JyBU7yR_8EYP8REHTp-s32T7IMptETGoxzd9Yjk/edit)
7. I found a way to spit a page of text into sentences in adjoining cells in a speadsheet [Experimental Polish Spreadsheet - Google Sheets](https://docs.google.com/spreadsheets/d/1C3B_5_cVmhYkrnbRKXNOsB6SxC-D75Yjv8Dczq0M9Ow/edit#gid=0). (Horizontal)
8. I found a way to transform from horizontal to vertical
9. [Consuming JSON Web Data Using Google Sheets | thisDaveJ](https://thisdavej.com/consuming-json-web-data-using-google-sheets/)
10. I learned that I had to get rid of all the accounts on my machine to come up with the right ownership for [Scraping code](https://script.google.com/a/macros/mike-wolf.com/d/Myz5iZMMITQ5F-at6kQrpWS8rPUj8PbJ6/edit?mid=ACjPJvGQ4ktePluap70sMHINCskR-UBM2N4AMnMizwAQGNp8knZ041psaMi_pKQ6zWKvqXldb9PiOnlisN0KS4_7Sre2e7fj2DTBwzLw7f2QtdTeXXMsehu222CJGv8izqj8vDYTyIpoWkU&uiv=2&f=Code)
11. I created a Apps Script function that could translate text from Polish to English.[How to Use the Google Translate API for Free - Digital Inspiration](https://www.labnol.org/code/19909-google-translate-api)
12. I modified it so I could put it in a series of cells.
13. I created an Apps Script function that would parse a body of text into sentences.
14. I did some research on [Cloud Text-to-Speech - Speech Synthesis | Google Cloud](https://cloud.google.com/text-to-speech)

I decided that doing it in a spreadsheet was the wrong idea, and I could control the audio in a Web App. So:

1. I found an React Widget that could play media hosted on varios media services. ([react-player - npm](https://www.npmjs.com/package/react-player))
2. I created a clone of a demo app [React Player - CodeSandbox](https://codesandbox.io/s/react-player-sezf9)
3. I tested it using content from YouTube and Soundcloud
  10. I found an app that would record an MP3 for me.
4. I played the first chapter of the book in Polish and used the App to record an MP3.
5. I uploaded the MP3 to SoundCloud (after some false starts)
6. I tested to make sure that I could play it back in my app. I could.
7. I found a way to copy/paste an entire chapter of the book in Polish into a string in my program.
8. I installed Material-UI and found the widget that I needed to present the text in the browser (Material-UI Typography)
9. I found a callback so that as the media is playing that I could get the current location.
10. I started writing a design doc for that.
  17.

## Fixing touchpad sensitivity

I don’t like the way that my new Windows machine’s touchpad works. I spent a bunch of time working on adjusting paramaters.

1. I found this [2 Ways to Change Touchpad Sensitivity in Windows 10 | Password Recovery](https://www.top-password.com/blog/change-touchpad-sensitivity-in-windows-10/) which did not work.
2. Finally found and then found out it was a common problem that needed new drivers. Finallly found these * [How to customize ‘Precision Touchpad’ settings on Windows 10 | Windows Central](https://www.windowscentral.com/how-customize-precision-touchpad-settings-windows-10)

- [How to enable a Precision Touchpad for more gestures on your laptop | Windows Central](https://www.windowscentral.com/how-enable-precision-touchpad-drivers)

## Research for Bobbi

1. I found Roberts Road where she used to live [Roberts Rd - Google Maps](https://www.google.com/maps/place/Roberts+Rd,+Cambridge,+MA+02138/@42.3768462,-71.1137805,18.69z/data=!4m5!3m4!1s0x89e37748bd556593:0x16511cf655d787b8!8m2!3d42.3763862!4d-71.1084356?hl=en)
2. I found how to turn Google Maps into a 3D ariel view:
   a. Switch to Earth view
   b. Switch to 3D mode
   c. Zoom around

That was a pretty full day.

[Click here to subscribe to 70 Years Old. WTF! by Email](https://feedburner.google.com/fb/a/mailverify?uri=70YearsOldWtf&loc=en_US)
