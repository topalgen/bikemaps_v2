from flask import Blueprint, render_template, abort
from app.data import get_crossings

bp = Blueprint("crossings", __name__, url_prefix="/crossings")


@bp.route("/")
def index():
    crossings = get_crossings()
    return render_template("crossings/index.html", crossings=crossings)


@bp.route("/<slug>")
def detail(slug):
    crossings = get_crossings()
    current = None
    prev_crossing = None
    next_crossing = None
    for i, c in enumerate(crossings):
        if c["slug"] == slug:
            current = c
            prev_crossing = crossings[i - 1] if i > 0 else None
            next_crossing = crossings[i + 1] if i < len(crossings) - 1 else None
            break
    if current is None:
        abort(404)
    return render_template(
        "crossings/detail.html",
        crossing=current,
        prev=prev_crossing,
        next=next_crossing,
    )
