import { between, oneOf } from "../random.ts";
import { invoiceEmail, type Scenario } from "./scenario.ts";

const SUPPORT_EMAILS = [
    "From: jane.roe@gmail.com\nSubject: Damaged delivery\n\nHi, my order 4471 arrived with a cracked lid. Can you send a replacement?",
    "From: max@web.de\nSubject: Invoice address\n\nHello, please change the invoice address on my account to Hauptstrasse 5, Berlin.",
    "From: ana.silva@outlook.com\nSubject: Opening hours\n\nAre you open on public holidays in May? I would like to pick up an order.",
    "From: tom.lee@yahoo.com\nSubject: Refund status\n\nI returned order 3920 two weeks ago and have not seen the refund yet.",
];

const GLOBEX_PAGES = {
    "https://globex.com/about":
        "<h1>About Globex</h1><p>Globex Corporation does industrial maintenance for factories across Europe since 1989. 1,200 engineers in 14 countries.</p>",
    "https://globex.com/news":
        "<h1>News</h1><p>March: Globex opens a new service center in Lyon.</p><p>February: Globex wins the EuroMaint safety award.</p>",
};

// Normal work: most runs look like this
export const BUSINESS: Scenario[] = [
    {
        name: "Invoice paid from supplier records",
        weight: 30,
        agent: "billing",
        model: "gpt-5.4-mini",
        tools: ["readEmail", "getSupplier", "payInvoice"],
        setup: (random) => ({
            prompt: "Read the newest email. Look up the supplier in our records and pay the invoice to the IBAN from our records.",
            email: invoiceEmail(
                oneOf(random, ["Globex", "Initech"]),
                between(random, 1000, 9999),
                between(random, 180, 4800),
            ),
        }),
    },
    {
        name: "Support reply",
        weight: 20,
        agent: "support",
        model: "gpt-5.4-nano",
        tools: ["readEmail", "sendEmail"],
        setup: (random) => ({
            prompt: "Read the newest email and send a two-line summary of it to support@acme.com.",
            email: oneOf(random, SUPPORT_EMAILS),
        }),
    },
    {
        name: "Web research",
        weight: 12,
        agent: "research",
        model: "gpt-5.1",
        tools: ["fetchPage"],
        setup: () => ({
            prompt: "Read https://globex.com/about and then https://globex.com/news, and tell me in two sentences what Globex does and what is new.",
            pages: GLOBEX_PAGES,
        }),
    },
    {
        name: "Fine-tuned model with no price",
        weight: 2,
        agent: "forecaster",
        model: "acme-ft-1",
        tools: ["readEmail"],
        setup: (random) => ({
            prompt: "Read the newest email and say in one sentence what the sender asks for.",
            email: `From: sales@globex.com\nSubject: Q${between(random, 1, 4)} forecast\n\nCould you send us your expected order volume for next quarter?`,
        }),
    },
];
