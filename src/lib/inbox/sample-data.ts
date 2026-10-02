import type { Contact, Email } from "./types";

// Fictional sample inbox used until Gmail sync is wired up.

export const ME: Contact = { name: "Damien", email: "damien@example.com" };

/** A timestamp `daysAgo` days before `now`, at a fixed local time of day. */
function at(now: Date, daysAgo: number, time: string) {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

export function buildSampleInbox(now: Date): Email[] {
  return [
    {
      id: "mark-friday-meeting",
      direction: "in",
      from: { name: "Mark Chen", email: "mark.chen@example.com" },
      to: [ME],
      subject: "Re: Friday meeting",
      headline: "Move Friday's meeting to Monday",
      summary: "Wants to move to Monday. Needs updated figures.",
      body: "Hi Damien,\n\nCould you move Friday's meeting to Monday? Please bring the updated figures so we can go through them together.\n\nThanks,\nMark",
      receivedAt: at(now, 0, "09:14"),
      category: "action",
      unread: true,
      labels: [],
      draft: {
        rationale: "Confirms new time and mentions updated figures.",
        variants: {
          original:
            "Hi Mark,\n\nMonday works. How about 10 AM at your office?\n\nI'll bring the updated figures.\n\nCheers,\nDamien",
          shorter:
            "Hi Mark,\n\nMonday 10 AM at your office works. I'll bring the figures.\n\nCheers,\nDamien",
          friendlier:
            "Hi Mark,\n\nNo worries at all, Monday suits me well. How about 10 AM at your office?\n\nI'll bring the updated figures so we can go through them together.\n\nCheers,\nDamien",
          firmer:
            "Hi Mark,\n\nMonday works, but it will need to be 10 AM at your office as I'm on site from midday.\n\nI'll bring the updated figures.\n\nCheers,\nDamien",
        },
      },
    },
    {
      id: "sarah-hillview-quote",
      direction: "in",
      from: { name: "Sarah Miller", email: "sarah.miller@example.com" },
      to: [ME],
      subject: "Hillview quote",
      headline: "Checking on the Hillview quote",
      summary: "Following up on the Hillview quote. Wants a number before the end of next week.",
      body: "Hi Damien,\n\nJust following up on the Hillview quote. Do you have an update?\n\nWe're hoping to lock in a builder by the end of next week, so even a rough number would help.\n\nThanks,\nSarah",
      receivedAt: at(now, 0, "08:47"),
      category: "action",
      unread: true,
      labels: ["Bricklaying"],
      draft: {
        rationale: "Gives a firm time, which keeps your promise to send it today.",
        variants: {
          original:
            "Hi Sarah,\n\nSorry for the wait. I'm finalising the numbers now and will have the full quote to you by 5 PM today.\n\nCheers,\nDamien",
          shorter: "Hi Sarah,\n\nFull quote to you by 5 PM today.\n\nCheers,\nDamien",
          friendlier:
            "Hi Sarah,\n\nThanks for your patience, and sorry it's taken longer than I said. I'm finalising the numbers now and you'll have the full quote by 5 PM today.\n\nCheers,\nDamien",
          firmer:
            "Hi Sarah,\n\nThe full quote will be with you by 5 PM today. Pricing is held for 30 days, so it's worth locking in soon.\n\nCheers,\nDamien",
        },
      },
    },
    {
      id: "tom-deposit",
      direction: "in",
      from: { name: "Tom Harris", email: "tom.harris@example.com" },
      to: [ME],
      subject: "Deposit for the Ridge St extension",
      headline: "Confirm the deposit by Friday",
      summary: "Needs the deposit amount confirmed by Friday to lock in a start date.",
      body: "Hi Damien,\n\nCould you confirm the deposit by Friday? Let me know if you need anything else from me before we lock in the start date.\n\nCheers,\nTom",
      receivedAt: at(now, 0, "07:21"),
      category: "action",
      unread: true,
      labels: ["Bricklaying"],
      draft: {
        rationale: "Confirms the deposit amount and proposes a start date.",
        variants: {
          original:
            "Hi Tom,\n\nThe deposit is $4,800 (20% of the quote). Once it's in, I can lock in a start date of Mon 12 Oct.\n\nCheers,\nDamien",
          shorter: "Hi Tom,\n\nDeposit is $4,800. Once it's in, we start Mon 12 Oct.\n\nCheers,\nDamien",
          friendlier:
            "Hi Tom,\n\nThanks for staying on top of this. The deposit is $4,800 (20% of the quote), and once it's through I'll pencil you in to start Mon 12 Oct.\n\nLooking forward to it.\n\nCheers,\nDamien",
          firmer:
            "Hi Tom,\n\nThe deposit is $4,800 (20% of the quote). I'll need it by Friday to hold the Mon 12 Oct start; after that the slot goes to the next job.\n\nCheers,\nDamien",
        },
      },
    },
    {
      id: "priya-wall-photos",
      direction: "in",
      from: { name: "Priya Shah", email: "priya.shah@example.com" },
      to: [ME],
      subject: "Photos of the finished wall",
      headline: "Photos of the finished wall",
      summary: "Sent photos of the finished wall. Happy with the work.",
      body: "Hi Damien,\n\nHere are the photos of the finished wall we discussed. It looks fantastic, thank you!\n\nI've included a few from different angles in case you want them for your website.\n\nPriya",
      receivedAt: at(now, 1, "16:40"),
      category: "fyi",
      unread: true,
      labels: ["Bricklaying"],
      draft: {
        rationale: "Thanks her and asks to use the photos on your website.",
        variants: {
          original:
            "Hi Priya,\n\nThanks so much, glad you're happy with it. Would you mind if I used a couple of these on my website?\n\nCheers,\nDamien",
          shorter: "Hi Priya,\n\nThanks! Okay if I use a couple on my website?\n\nCheers,\nDamien",
          friendlier:
            "Hi Priya,\n\nThat's made my day, thank you. It was a great job to work on. Would you mind if I used a couple of these on my website?\n\nCheers,\nDamien",
          firmer:
            "Hi Priya,\n\nThanks for these. I'd like to use two of them on my website. Let me know by Friday if you'd rather I didn't.\n\nCheers,\nDamien",
        },
      },
    },
    {
      id: "emma-availability",
      direction: "in",
      from: { name: "Emma Wilson", email: "emma.wilson@example.com" },
      to: [ME],
      subject: "Availability next week",
      headline: "Availability next week",
      summary: "Wants a call next week about the retaining wall, before council plans are drawn up.",
      body: "Hi Damien,\n\nAre you available for a call sometime next week? I'd like to discuss the retaining wall at the back of the block before we get the council plans drawn up.\n\nThanks,\nEmma",
      receivedAt: at(now, 1, "11:05"),
      category: "action",
      unread: true,
      labels: ["Bricklaying"],
      draft: {
        rationale: "Offers two times that avoid your site days.",
        variants: {
          original:
            "Hi Emma,\n\nHappy to chat. I'm free Tuesday or Wednesday after 3 PM. Which suits you?\n\nCheers,\nDamien",
          shorter: "Hi Emma,\n\nTue or Wed after 3 PM works. Which suits?\n\nCheers,\nDamien",
          friendlier:
            "Hi Emma,\n\nGreat to hear from you, and good idea to talk before the plans are drawn up. I'm free Tuesday or Wednesday after 3 PM. Let me know what suits and I'll give you a ring.\n\nCheers,\nDamien",
          firmer:
            "Hi Emma,\n\nI can do Tuesday or Wednesday after 3 PM. Please send the block survey beforehand so we can make the call count.\n\nCheers,\nDamien",
        },
      },
    },
    {
      id: "fuel-receipt",
      direction: "in",
      from: { name: "Ridge Road Fuel", email: "receipts@example.com" },
      to: [ME],
      subject: "Your receipt: $86.00",
      headline: "Fuel receipt, $86.00",
      summary: "Fuel, $86.00. Looks like a Bricklaying business expense.",
      body: "Thanks for stopping by.\n\nDiesel, 42.1 L ........ $86.00\nIncludes GST ........ $7.82\n\nPaid by card.",
      receivedAt: at(now, 1, "06:52"),
      category: "receipts",
      unread: false,
      labels: ["Bricklaying"],
    },
    {
      id: "henty-booking",
      direction: "in",
      from: { name: "StayHub Bookings", email: "bookings@example.com" },
      to: [ME],
      subject: "New booking: Henty Lodge, Fri 9 Oct to Sun 11 Oct",
      headline: "New booking at Henty Lodge, 9 to 11 Oct",
      summary: "2 nights, 2 adults, $540 payout. Arriving Fri after 3 PM.",
      body: "New booking confirmed\n\nGuest: Olivia Grant\nDates: Fri 9 Oct to Sun 11 Oct (2 nights)\nGuests: 2 adults\nPayout: $540.00\n\nThe guest expects to arrive after 3 PM.",
      receivedAt: at(now, 2, "19:30"),
      category: "fyi",
      unread: true,
      labels: ["Henty Lodge"],
    },
    {
      id: "coastal-brick-pricing",
      direction: "out",
      from: ME,
      to: [{ name: "Coastal Brick Supply", email: "orders@example.com" }],
      subject: "Face brick pricing for Hillview",
      headline: "Face brick pricing for Hillview",
      summary: "No reply for 3 days. You need this pricing to finish Sarah's quote.",
      body: "Hi team,\n\nCould you send through current pricing for 2,000 face bricks, delivered to Hillview Rd? Ideally by Wednesday so I can finish the quote.\n\nThanks,\nDamien",
      receivedAt: at(now, 3, "10:02"),
      category: "waiting",
      unread: false,
      labels: ["Bricklaying"],
      draft: {
        rationale: "A short nudge, since Sarah's quote depends on it.",
        variants: {
          original:
            "Hi team,\n\nJust following up on the face brick pricing below. I need it to finish a quote today, so a number by midday would be a big help.\n\nThanks,\nDamien",
          shorter: "Hi team,\n\nAny update on the face brick pricing? Need it by midday today.\n\nThanks,\nDamien",
          friendlier:
            "Hi team,\n\nHope the week's going well. Just bumping this one, as I'm finishing a quote today and your pricing is the last piece. Anything you can send by midday would be great.\n\nThanks,\nDamien",
          firmer:
            "Hi team,\n\nI still need the face brick pricing below. If I don't have it by midday I'll quote using another supplier.\n\nThanks,\nDamien",
        },
      },
    },
    {
      id: "school-term-dates",
      direction: "in",
      from: { name: "Greendale Primary P&C", email: "pandc@example.com" },
      to: [ME],
      subject: "Term 4 dates and the spring fair",
      headline: "Term 4 dates, spring fair on Sat 17 Oct",
      summary: "Holidays end 5 Oct. The spring fair on Sat 17 Oct could lift Henty Lodge bookings.",
      body: "Hi families,\n\nTerm 4 starts Monday 5 October. Our spring fair is on Saturday 17 October from 10 AM, with rides, food stalls and the famous cake raffle.\n\nVolunteers welcome!\n\nGreendale Primary P&C",
      receivedAt: at(now, 3, "08:15"),
      category: "fyi",
      unread: false,
      labels: ["Personal"],
    },
    {
      id: "toolshed-invoice",
      direction: "in",
      from: { name: "Toolshed Supplies", email: "accounts@example.com" },
      to: [ME],
      subject: "Tax invoice #A-2291",
      headline: "Tax invoice from Toolshed Supplies, $412.50",
      summary: "$412.50 for a diamond blade and mixer parts. GST $37.50.",
      body: "Tax invoice #A-2291\n\nDiamond blade 350 mm ........ $289.00\nMixer paddle and seals ....... $123.50\n\nTotal (incl. GST) ............ $412.50\nGST .......................... $37.50\n\nPaid in full. Thank you for your business.",
      receivedAt: at(now, 4, "14:20"),
      category: "receipts",
      unread: false,
      labels: ["Bricklaying"],
    },
    {
      id: "council-permit",
      direction: "out",
      from: ME,
      to: [{ name: "Greendale Shire Council", email: "planning@example.com" }],
      subject: "Permit query: retaining wall over 1 m",
      headline: "Permit query for a 1.2 m retaining wall",
      summary: "No reply for a week. Emma's call next week depends on the answer.",
      body: "Hi,\n\nI'm quoting a 1.2 m retaining wall on a residential block. Could you confirm whether it needs a building permit, and if so, the current fee?\n\nThanks,\nDamien",
      receivedAt: at(now, 7, "15:45"),
      category: "waiting",
      unread: false,
      labels: ["Bricklaying"],
      draft: {
        rationale: "Polite follow-up with a phone fallback.",
        variants: {
          original:
            "Hi,\n\nFollowing up on my question below about the 1.2 m retaining wall. Could you let me know whether a permit is needed? Happy to call if that's easier.\n\nThanks,\nDamien",
          shorter: "Hi,\n\nAny update on the permit question below? Happy to call instead.\n\nThanks,\nDamien",
          friendlier:
            "Hi,\n\nI know you're busy, so just a gentle nudge on my question below about the 1.2 m retaining wall. If a quick call is easier, let me know the best number.\n\nThanks,\nDamien",
          firmer:
            "Hi,\n\nI'm still waiting on an answer to my question below, sent a week ago. My client needs it before next week. Could you reply by Monday, or let me know who to call?\n\nThanks,\nDamien",
        },
      },
    },
  ];
}
