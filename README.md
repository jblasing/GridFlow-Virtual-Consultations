# GridFlow Virtual Consultations

Customer self-scheduling and pre-consultation intake for whole-home generator leads.

## Initial workflow

1. GridFlow posts a qualified lead to `POST /api/invitations`.
2. The service sends a branded HTML email and SMS with a private booking link.
3. Zuper Assisted Scheduling supplies Brandon Whisnant's availability.
4. The customer selects a 45-minute appointment within seven days.
5. The existing Zuper Generator Sales Lead job is reassigned to Brandon and scheduled.
6. The customer completes the mobile pre-virtual checklist and uploads five photos.
7. Checklist details and photos are emailed to Brandon and added to the Zuper job.
8. The private booking link supports rescheduling and cancellation.

## Booking rules

- Monday-Friday: 9:00 AM-7:00 PM Central
- Saturday: 10:00 AM-4:00 PM Central
- Sunday: disabled by default; event hours can be enabled at `/admin/sunday`
- Appointment: 45 minutes
- Buffer: 20 minutes
- Minimum notice: 1 hour
- Booking horizon: 7 days

## Checklist

- Home address confirmation
- House square footage
- Natural gas or propane
- Main breaker panel photo
- Electric meter photo showing the electric company
- Gas meter/regulator or propane tank photo
- Desired generator location detail photo showing clearances
- Wide generator-location photo

## Local validation

```bash
npm install
npm run check
npm test
```

## Required configuration

Copy `.env.example` into Render environment variables. Secrets must never be committed.

## CRM invitation payload

```json
{
  "job_uid": "zuper-job-uid",
  "customer_name": "Customer Name",
  "customer_email": "customer@example.com",
  "customer_phone": "9365550100",
  "home_address": "123 Main St, City, TX 77300",
  "source": "Generac - Web"
}
```

Send the shared CRM secret in the `x-gridflow-secret` header.
