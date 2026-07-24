---
title: "75 Years - 2 days: The list of posts and drafts"
collection: "70YearsWTF"
kind: "post"
order: 0
date: "2017-12-29"
author: "Mike Wolf"
original_url: "https://70yearswtf.substack.com/p/75-years-2-days-the-list-of-posts-17-12-29"
excerpt: "This morning I decided to make a document containing all of my posts. The idea was to tag any posts that had not been tagged, then sort by tag, then organize into one or more documents that grouped like posts…"
word_count: 438
tags:
  - "70YearsWTF"
  - "blogging"
related: []
---

This morning I decided to make a document containing all of my posts. The idea was to tag any posts that had not been tagged, then sort by tag, then organize into one or more documents that grouped like posts together. Kind of the way that Miles Kimball does on his blog.
It seemed like a not too hard project. I could grab the list of posts that Blogger kindly provides, then parse the HTML, and then . I looked to see if this was an already solved problem. After all, what I was doing was scraping content from a web page, and web scraping is a pretty mature technology category, isn't it? Maybe it is, but many hours into the project I was not convinced.
I started out with a post,"Top 30 Free Web Scraping Software." I ran down the list skipping anything that required me to download a library or a tool, and looked at the ones that ran scraping services from the web. I settled on [ScapingHub's](https://scrapinghub.com/) service called [Portia](https://scrapinghub.com/portia) which (a) was free and (b) had a point and click interface for specifying what you wanted to scrape. Several hours later I had something that scraped some of my existing posts but which failed to scrape them all, for unknown reasons. So I tried to do it a different way. This got me more posts, but still only about a quarter of what I'd produced.
Next, I decided that I'd programatically read pages and parse the HTML using a node library. Simple in concept, but difficult in execution. Several hours later I had figured out how to solve various problems that I'd encounter, but didn't have anything that worked.
But wait! Maybe the was another way to do it. I could bring up the page with my list of drafts and copy/paste it into a spreadsheet. Which didn't work. Pasting into a spreadsheet kept the post names, but stripped out the links. But I could paste the list into a document, then extract the document and put it into a spreadsheet. That worked. Except that the links went to the pages that let me edit the posts and not to the published posts themselves.
So it's back to reading web pages and extracting data, formatting the results as markdown and then converting the markdown back to HTML, or something like that.
I'll find the answer tomorrow. In the meantime, I learned a lot. I had some fun. And I've got a ton of stuff that I visited along the way that I want to write about.
But that will be tomorrow. Not today.
