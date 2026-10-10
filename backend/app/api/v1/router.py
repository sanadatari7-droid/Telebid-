from fastapi import APIRouter
from app.api.v1.endpoints import (
    lost_records,
    won_records,
    company_config,
    service_categories,
    bonds,
    opportunities_v2,
    auth, bids, opportunities, vendors,
    references, employees, notifications,
    users, reports, evaluations, contracts,
    watchlist, scheduler, comments,
    settings, ict, expro, bid_logs,
    search, location, excel_import,
    content_library,
    clients, rfps, rfp_evaluation, rfp_bond, rfp_checklist
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(clients.router)
# Modules 2–4 (RFP ICT, RFP Telecom, EXPRO) share one engine under /rfps/{module}.
api_router.include_router(rfps.router)
api_router.include_router(rfp_evaluation.router)
api_router.include_router(rfp_bond.router)
api_router.include_router(rfp_checklist.router)
api_router.include_router(opportunities_v2.router)
api_router.include_router(bonds.router)
api_router.include_router(service_categories.router)
api_router.include_router(company_config.router)
api_router.include_router(won_records.router)
api_router.include_router(lost_records.router)
api_router.include_router(auth.router)
api_router.include_router(bids.router)
api_router.include_router(opportunities.router)
api_router.include_router(vendors.router)
api_router.include_router(references.router)
api_router.include_router(employees.router)
api_router.include_router(notifications.router)
api_router.include_router(users.router)
api_router.include_router(reports.router)
api_router.include_router(evaluations.router)
api_router.include_router(contracts.router)
api_router.include_router(watchlist.router)
api_router.include_router(scheduler.router)
api_router.include_router(comments.router)
api_router.include_router(settings.router)
api_router.include_router(ict.router)
api_router.include_router(expro.router)
api_router.include_router(bid_logs.router)
api_router.include_router(search.router)
api_router.include_router(location.router)
api_router.include_router(excel_import.router)
api_router.include_router(content_library.router)
