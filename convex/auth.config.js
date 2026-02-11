export default {
    providers: [
        {
            domain: process.env.CLERK_ISSUER_URL || "https://clerk.your-domain.com",
            applicationID: "convex",
        },
    ],
};
