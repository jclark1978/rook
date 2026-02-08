# Rook Online — Rules Preset: “Jeff House Rules” (v1)

This document specifies the default rules preset to implement for the first playable online version.

## 1) Game Settings (per game)
- **Target score:** configurable at game start; default **700**.
- **Deck mode:**
  - **Full**: 57 cards (1–14 in 4 colors = 56, plus the Rook card = 1). Deal **13 each** + **5-card kitty**.
  - **Fast**: 45 cards (remove 2/3/4 from each color: −12 from the 56 suited cards; plus the Rook card). Deal **10 each** + **5-card kitty**.
- **Rook rank mode:**
  - **Rook High:** Rook is the highest trump.
  - **Rook Low:** Rook is the lowest trump.

## 2) Players / Teams
- Exactly **4 players**.
- Fixed partnerships (2 vs 2).
- Seating order is alternating teams:
  - **T1P1, T2P1, T1P2, T2P2**.

## 3) Card Rank & Trick Rules
### Rank within a color (non-trump)
- Normal high-to-low numbering **except 1 is highest**.
- Example order (full deck): **1, 14, 13, …, 2**.

### Trump
- A single **trump color** is declared by the winning bidder.
- **Rook always counts as trump**.
- Trump beats non-trump.

### Following suit
- Players **must follow suit** if they can.
- If a player cannot follow suit, they may play **any card** (trumping is optional).

## 4) Scoring (200 points per hand)
Only these score:
- **Rook card:** 20 points
- **Last trick bonus:** 20 points
- Per color (4 colors):
  - **1 = 15**
  - **5 = 5**
  - **10 = 10**
  - **14 = 10**

Total available points per hand:
- Per color: 15 + 5 + 10 + 10 = 40
- 4 colors: 160
- + Rook (20) = 180
- + Last trick (20) = **200**

### Kitty points
- The kitty exists during play (after discard) and is awarded (for scoring) to the **team that wins the last trick**.

## 5) Bidding
- Bidding is for the right to take the kitty and declare trump.
- **Minimum bid:** 100
- **Bid increment:** 5
- **Open bidding:** all bids/passes and bid history are visible to all.

### Pass
- A player may **Pass**; once passed, they are **out** of bidding for the round.

### Pass-Partner (special)
- A player may **Pass-Partner** only when their partner is currently the **high bidder** (i.e., the player would otherwise need to bid against partner).
- Pass-Partner is a **skip** (the player is **not out** of bidding).
- Each team may use Pass-Partner **once per round**.

### Bid end condition
- Bidding ends when **3 players have passed**.

## 6) Kitty pickup / discard
- Bid winner picks up the **5-card kitty** privately (partner does not see it).
- Bid winner then discards **5 cards** back to the kitty (privately), returning to the normal hand size.
- Bid winner declares **trump color**.

## 7) Leading
- For the **first trick only**, the bid winner chooses:
  - to lead first trick themselves, or
  - to pass the first lead to the player on their **left**.
- For all subsequent tricks, **trick winner leads**.

## 8) Contract resolution
- The winning bid is the minimum number of points the bidder’s team must take.
- At end of hand, compute points captured by each team (including last-trick bonus and kitty assignment).

Scoring by team:
- **Defending team:** scores the points it captured.
- **Bidding team:**
  - if captured points **>= bid**: scores the points it captured
  - if captured points **< bid**: scores **exactly −bid** (regardless of points captured)

## 9) Misclick take-back (online convenience rule)
- A player may undo a played card **only until the next player makes a play**.
- After any subsequent action, the play is final.
