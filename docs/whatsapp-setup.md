# WhatsApp for the Regal till — setting it up

The till can use WhatsApp two ways (Settings → Messages → WhatsApp):

| Mode | What happens | Needs |
|---|---|---|
| **Open WhatsApp on this PC** (default) | Every WhatsApp button opens WhatsApp Desktop / Web on the customer's number with the message typed in. You press Send. | Nothing — works today. |
| **Send automatically** (WhatsApp Business Cloud API) | The server sends through Meta. Bills, receipts, statements and order updates go out by themselves; customers' replies land on the Messages page. | A Meta business account, a verified WhatsApp number, a token, approved templates. |

Everything below is for the second mode.

## 1. Accounts (business.facebook.com / developers.facebook.com)

1. **Business portfolio** — business.facebook.com → *Create a business portfolio* → "Regal Hardware", your name, email.
2. **Developer app** — developers.facebook.com → *My Apps* → *Create App* → use case *Other* → type **Business** → name "Regal Till" → connect it to the Regal Hardware portfolio.
3. In the app dashboard: *Add product* → **WhatsApp** → *Set up*. Meta creates a WhatsApp Business Account (WABA) and gives you a **test number** you can use straight away with up to 5 recipient numbers.
4. **Business verification** — Business Settings → *Security Centre* → *Start verification*. Upload the business registration and something with the address and phone (a utility bill or bank statement). Until verified you are limited to about 250 customers a day and the display name shows as unverified.

## 2. The number

The number for the API **cannot be on the WhatsApp app at the same time**. If 0772222259 is on a phone today, either
- delete that WhatsApp account first (WhatsApp → Settings → Account → Delete my account — chats and groups are lost), or
- put a **new SIM** on the API and keep chatting from the phone on the old number (what most shops do).

Then: app → WhatsApp → *API Setup* → *Add phone number* → display name "Regal Hardware", category, the number → verify by SMS or call.

## 3. Token and IDs

1. Business Settings → *Users* → **System users** → *Add* → name "regal-till", role **Admin**.
2. *Add assets* → Apps → your app → full control; *Add assets* → WhatsApp accounts → your WABA → full control.
3. *Generate new token* → pick the app → expiry **Never** → permissions `whatsapp_business_messaging` and `whatsapp_business_management` → copy the token (shown once).
4. The **Phone number ID** is on the API Setup page under the number (a long number, not the phone number).

Test them before typing them into the till:

```
node backend/tools/wa-check.mjs <PHONE_NUMBER_ID> <TOKEN> 0777849964
```

That prints what Meta knows about the number, lists templates, and sends the built-in `hello_world` template to the number given.

Then in the till: Settings → Messages → WhatsApp → *Send automatically* → paste both → **Check the number**.

## 4. Templates

A message to a customer who has not written to you in the last 24 hours must be a template Meta has approved. The till ships with five. Each is laid out like every other message — the customers' greeting and the shop's sign-off from Settings → Messages are fixed text in the template, taken when you press *Register* (so set them first):

```
Dear Customer,
Your bill {{1}} for {{2}} is ready. See it at {{3}} any time.

Thank you,
Regal Hardware
077 222 22 59
```

| Template | The middle line | Used for |
|---|---|---|
| `regal_bill_v2` | Your bill {{1}} for {{2}} is ready. See it at {{3}} any time. | cash bill, credit bill, bill sent again |
| `regal_payment_v2` | We have received your payment of {{1}}, receipt {{2}}. Your balance is now {{3}}. | payment received |
| `regal_statement_v2` | Your statement for {{1}}: {{2}} unpaid bill(s), total {{3}}. See them at {{4}} any time. | statement |
| `regal_portal_v2` | You can check what you owe any time at {{1}}. Sign in with a code we text you. | invite to their page |
| `regal_order_v2` | Your order {{1}} for {{2}} is {{3}}. | online order updates |

Changing the greeting or sign-off later does not change templates already approved — register them again under new names for that.

Press **Register the standard templates** once (they are created on your account as *Utility*, English). Meta approves in minutes to a day. Press **Fetch from Meta** to see their state; the mapping table shows which template carries which message and in what order the till fills the {{n}} slots. You can make your own templates in WhatsApp Manager and pick them there instead.

Tick *Also send every automatic text on WhatsApp* and every text the till raises (bill after a sale, receipt, statement, order update) goes out on WhatsApp too — while **test mode** on the same page is filled in, only those numbers get anything.

## 5. Replies (webhook)

So that customers' answers show on the Messages page (and so staff can reply in free text inside the 24-hour window):

1. Settings → Messages → WhatsApp → *Webhook verify token* — type any word, e.g. `regal-2026`.
2. Meta app → WhatsApp → *Configuration* → Webhook → *Edit*: Callback URL `https://<your site>/api/wa/webhook`, Verify token the same word → *Verify and save*.
3. *Webhook fields* → subscribe to **messages**.

The till checks for replies every minute; the bell rings when new ones arrive. Delivery and read receipts update the status of what the till sent.

## Cost

Meta charges per message to the card on the Facebook ad account attached to the business. Utility messages in Sri Lanka are a few rupees each; replies inside a customer-started 24-hour conversation are free.

## Easier route

A local provider (Dialog's WhatsApp Business service) or a global one (Twilio, 360dialog) resells the same API and does the verification and templates for you. They still give you a phone number ID and token — or their own API, which is wired in the same way as SMSlenz.
