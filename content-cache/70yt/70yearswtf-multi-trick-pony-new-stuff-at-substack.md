---
title: "Multi Trick Pony: New stuff at Substack"
collection: "70YearsWTF"
kind: "post"
order: 0
date: "2024-12-18"
author: "Mike Wolf"
original_url: "https://70yearswtf.substack.com/p/multi-trick-pony-new-stuff-at-substack"
excerpt: "I haven’t been posting anything on Substack for a while. While trying to re-reboot myself I discovered a bunch of new stuff you can do with Substack. Polls Yippee! I can create polls. Custom Buttons Wow! I can make a…"
word_count: 210
tags:
  - "70YearsWTF"
related: []
---

I haven’t been posting anything on Substack for a while.

While trying to re-reboot myself I discovered a bunch of new stuff you can do with Substack.

# Polls

Yippee! I can create polls.

# Custom Buttons

Wow!  I can make a custom botton.

[Click the custom button!!.](https://www.mike-wolf.com/)

# Polls about Custom Buttons

I can combine these two features and do this:

# Code

You can write code. This is about as lame as you can get.

```
async def handle_oauth_flow(config):
    # Start localtunnel
    logger.info("Starting localtunnel...")
    lt_process = subprocess.Popen(
        ['lt', '--port', str(DEFAULT_PORT),'--subdomain', str(DEFAULT_DOMAIN)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    # Wait for localtunnel to start and get the URL
    time.sleep(2)
    lt_url = None
    while lt_process.poll() is None:
        output = lt_process.stdout.readline().decode().strip()
        if 'your url is: ' in output:
            lt_url = output.split('your url is: ')[1]
            break

    if not lt_url:
        logger.error("Failed to start localtunnel")
        return False
    config.lt_url = lt_url
```

# Poetry

In case I need to write a poem where spacing matters I can do this.

Text within this block will maintain its original spacing when published

```
Roses are red
     Violets are blue
           This preserves spacing
                 Whoop dee doo!!
```

# LateX

This should be called LameteX

## Financial Chart

For those interested in financial charts, here’s one

![TradingView chart](/media/70yt/multi-trick-pony-new-stuff-at-substack/1.jpg)

*Created with [TradingView](https://tradingview.com)*

## And finally
