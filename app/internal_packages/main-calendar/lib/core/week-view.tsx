/* eslint react/jsx-no-bind: 0 */
import _ from 'underscore';
import moment, { Moment } from 'moment-timezone';
import classnames from 'classnames';
import React from 'react';
import ReactDOM from 'react-dom';
import { Utils } from 'mailspring-exports';
import { ScrollRegion, InjectedComponentSet } from 'mailspring-component-kit';
import { HeaderControls } from './header-controls';
import { EventOccurrence } from './calendar-data-source';
import { EventGridBackground } from './event-grid-background';
import { WeekViewEventColumn } from './week-view-event-column';
import { WeekViewAllDayEvents } from './week-view-all-day-events';
import { CalendarEventContainer } from './calendar-event-container';
import { CurrentTimeIndicator } from './current-time-indicator';
import { Disposable } from 'rx-core';
import { overlapForEvents, maxConcurrentEvents } from './week-view-helpers';
import { MailspringCalendarViewProps } from './mailspring-calendar';

const BUFFER_DAYS = 7; // in each direction
const DAYS_IN_VIEW = 7;
const MIN_INTERVAL_HEIGHT = 21;
const DAY_DUR = moment.duration(1, 'day').as('seconds');
const INTERVAL_TIME = moment.duration(30, 'minutes').as('seconds');

// This pre-fetches from Utils to prevent constant disc access
const overlapsBounds = Utils.overlapsBounds;

export class WeekView extends React.Component<
  MailspringCalendarViewProps,
  { intervalHeight: number; events: EventOccurrence[] }
> {
  static displayName = 'WeekView';

  _waitingForShift = 0;
  _mounted: boolean = false;
  _sub?: Disposable;
  _lastWrapHeight: number;

  constructor(props) {
    super(props);
    this.state = {
      events: [],
      intervalHeight: MIN_INTERVAL_HEIGHT,
    };
  }

  componentDidMount() {
    this._mounted = true;
    this._centerScrollRegion();
    this._setIntervalHeight();
    window.addEventListener('resize', this._setIntervalHeight, true);
    const wrap = ReactDOM.findDOMNode(this.refs.calendarAreaWrap) as HTMLElement;
    wrap.scrollLeft += wrap.clientWidth;
    this.updateSubscription();
  }

  componentDidUpdate(prevProps) {
    this._setIntervalHeight();
    const wrap = ReactDOM.findDOMNode(this.refs.calendarAreaWrap) as HTMLElement;
    wrap.scrollLeft += this._waitingForShift;
    this._waitingForShift = 0;
    if (
      prevProps.focusedMoment !== this.props.focusedMoment ||
      prevProps.disabledCalendars !== this.props.disabledCalendars
    ) {
      this.updateSubscription();
    }
  }

  componentWillUnmount() {
    this._mounted = false;
    this._sub.dispose();
    window.removeEventListener('resize', this._setIntervalHeight);
  }

  // Indirection for testing purposes
  _now() {
    return moment();
  }

  updateSubscription() {
    if (this._sub) {
      this._sub.dispose();
    }

    const { start, end } = this._calculateMomentRange();

    this._sub = this.props.dataSource
      .buildObservable({
        disabledCalendars: this.props.disabledCalendars,
        startUnix: start.unix(),
        endUnix: end.unix(),
      })
      .subscribe(state => {
        this.setState(state);
      });
  }

  _calculateMomentRange() {
    const { focusedMoment } = this.props;
    let start: Moment;

    // NOTE: Since we initialize a new time from one of the properties of
    // the props.focusedMoment, we need to check for the timezone!
    //
    // Other relative operations (like adding or subtracting time) are
    // independent of a timezone.
    const tz = focusedMoment.tz();
    if (tz) {
      start = moment.tz([focusedMoment.year()], tz);
    } else {
      start = moment([focusedMoment.year()]);
    }

    start = start
      .weekday(0)
      .week(focusedMoment.week())
      .subtract(BUFFER_DAYS, 'days');

    const end = moment(start)
      .add(BUFFER_DAYS * 2 + DAYS_IN_VIEW, 'days')
      .subtract(1, 'millisecond');

    return { start, end };
  }

  _renderDateLabel = (day, idx) => {
    const className = classnames({
      'day-label-wrap': true,
      'is-today': this._isToday(day),
    });
    return (
      <div className={className} key={idx}>
        <span className="date-label">{day.format('D')}</span>
        <span className="weekday-label">{day.format('ddd')}</span>
      </div>
    );
  };

  _isToday(day) {
    const todayYear = this._now().year();
    const todayDayOfYear = this._now().dayOfYear();

    return todayDayOfYear === day.dayOfYear() && todayYear === day.year();
  }

  _renderEventColumn = (eventsByDay, day) => {
    const dayUnix = day.unix();
    const events = eventsByDay[dayUnix];
    return (
      <WeekViewEventColumn
        day={day}
        dayEnd={dayUnix + DAY_DUR - 1}
        key={day.valueOf()}
        events={events}
        eventOverlap={overlapForEvents(events)}
        focusedEvent={this.props.focusedEvent}
        selectedEvents={this.props.selectedEvents}
        onEventClick={this.props.onEventClick}
        onEventDoubleClick={this.props.onEventDoubleClick}
        onEventFocused={this.props.onEventFocused}
      />
    );
  };

  _allDayEventHeight(allDayOverlap) {
    if (_.size(allDayOverlap) === 0) {
      return 0;
    }
    return maxConcurrentEvents(allDayOverlap) * MIN_INTERVAL_HEIGHT + 1;
  }

  _daysInView() {
    const { start } = this._calculateMomentRange();
    const days: Moment[] = [];
    for (let i = 0; i < DAYS_IN_VIEW + BUFFER_DAYS * 2; i++) {
      // moment::weekday is locale aware since some weeks start on diff
      // days. See http://momentjs.com/docs/#/get-set/weekday/
      days.push(moment(start).weekday(i));
    }
    return days;
  }

  _onClickToday = () => {
    this.props.onChangeFocusedMoment(this._now());
  };

  _onClickNextWeek = () => {
    const newMoment = moment(this.props.focusedMoment).add(1, 'week');
    this.props.onChangeFocusedMoment(newMoment);
  };

  _onClickPrevWeek = () => {
    const newMoment = moment(this.props.focusedMoment).subtract(1, 'week');
    this.props.onChangeFocusedMoment(newMoment);
  };

  _gridHeight() {
    return (DAY_DUR / INTERVAL_TIME) * this.state.intervalHeight;
  }

  _centerScrollRegion() {
    const wrap = ReactDOM.findDOMNode(this.refs.eventGridWrap) as HTMLElement;
    wrap.scrollTop = this._gridHeight() / 2 - wrap.getBoundingClientRect().height / 2;
  }

  // This generates the ticks used mark the event grid and the
  // corresponding legend in the week view.
  *_tickGenerator({ type }) {
    const height = this._gridHeight();

    let step = INTERVAL_TIME;
    let stepStart = 0;

    // We only use a moment object so we can properly localize the "time"
    // part. The day is irrelevant. We just need to make sure we're
    // picking a non-DST boundary day.
    const start = moment([2015, 1, 1]);

    let duration = INTERVAL_TIME;
    if (type === 'major') {
      step = INTERVAL_TIME * 2;
      duration += INTERVAL_TIME;
    } else if (type === 'minor') {
      step = INTERVAL_TIME * 2;
      stepStart = INTERVAL_TIME;
      duration += INTERVAL_TIME;
      start.add(INTERVAL_TIME, 'seconds');
    }

    const curTime = moment(start);
    for (let tsec = stepStart; tsec <= DAY_DUR; tsec += step) {
      const y = (tsec / DAY_DUR) * height;
      yield { time: curTime, yPos: y };
      curTime.add(duration, 'seconds');
    }
  }

  _setIntervalHeight = () => {
    if (!this._mounted) {
      return;
    } // Resize unmounting is delayed in tests
    const wrap = ReactDOM.findDOMNode(this.refs.eventGridWrap) as HTMLElement;
    const wrapHeight = wrap.getBoundingClientRect().height;
    if (this._lastWrapHeight === wrapHeight) {
      return;
    }
    this._lastWrapHeight = wrapHeight;
    const numIntervals = Math.floor(DAY_DUR / INTERVAL_TIME);
    (ReactDOM.findDOMNode(
      this.refs.eventGridLegendWrap
    ) as HTMLElement).style.height = `${wrapHeight}px`;
    this.setState({
      intervalHeight: Math.max(wrapHeight / numIntervals, MIN_INTERVAL_HEIGHT),
    });
  };

  _onScrollGrid = event => {
    (ReactDOM.findDOMNode(this.refs.eventGridLegendWrap) as HTMLElement).scrollTop =
      event.target.scrollTop;
  };

  _onScrollCalendarArea = event => {
    if (!event.currentTarget.scrollLeft || this._waitingForShift) {
      return;
    }

    const edgeWidth = (event.currentTarget.clientWidth / DAYS_IN_VIEW) * 2;

    if (event.currentTarget.scrollLeft < edgeWidth) {
      this._waitingForShift = event.currentTarget.clientWidth;
      this._onClickPrevWeek();
    } else if (
      event.currentTarget.scrollLeft >
      event.currentTarget.scrollWidth - event.currentTarget.clientWidth - edgeWidth
    ) {
      this._waitingForShift = -event.currentTarget.clientWidth;
      this._onClickNextWeek();
    }
  };

  _renderEventGridLabels() {
    const labels = [];
    let centering = 0;
    for (const { time, yPos } of this._tickGenerator({ type: 'major' })) {
      const hr = time.format('LT'); // Locale time. 2:00 pm or 14:00
      const style = { top: yPos - centering };
      labels.push(
        <span className="legend-text" key={yPos} style={style}>
          {hr}
        </span>
      );
      centering = 8; // center all except the 1st one.
    }
    return labels.slice(0, labels.length - 1);
  }

  _bufferRatio() {
    return (BUFFER_DAYS * 2 + DAYS_IN_VIEW) / DAYS_IN_VIEW;
  }

  // We calculate events by days so we only need to iterate through all
  // events in the span once.
  _eventsByDay(days: Moment[]) {
    const map: { allDay: EventOccurrence[]; [dayUnix: string]: EventOccurrence[] } = { allDay: [] };

    const unixDays = days.map(d => d.unix());
    unixDays.forEach(day => {
      map[`${day}`] = [];
    });

    this.state.events.forEach(event => {
      if (event.isAllDay) {
        map.allDay.push(event);
      } else {
        for (const day of unixDays) {
          const bounds = {
            start: day,
            end: day + DAY_DUR - 1,
          };
          if (overlapsBounds(bounds, event)) {
            map[`${day}`].push(event);
          }
        }
      }
    });

    return map;
  }

  render() {
    const days = this._daysInView();
    const todayColumnIdx = days.findIndex(d => this._isToday(d));
    const eventsByDay = this._eventsByDay(days);
    const allDayOverlap = overlapForEvents(eventsByDay.allDay);
    const tickGen = this._tickGenerator.bind(this);
    const gridHeight = this._gridHeight();

    const { start: startMoment, end: endMoment } = this._calculateMomentRange();

    const start = moment(startMoment).add(BUFFER_DAYS, 'days');
    const end = moment(endMoment).subtract(BUFFER_DAYS, 'days');
    const headerText = `${start.format('MMMM D')} - ${end.format('MMMM D YYYY')}`;

    return (
      <div className="calendar-view week-view">
        <CalendarEventContainer
          ref="calendarEventContainer"
          onCalendarMouseUp={this.props.onCalendarMouseUp}
          onCalendarMouseDown={this.props.onCalendarMouseDown}
          onCalendarMouseMove={this.props.onCalendarMouseMove}
        >
          <div className="top-banner">
            <InjectedComponentSet matching={{ role: 'Calendar:Week:Banner' }} direction="row" />
          </div>

          <HeaderControls
            title={headerText}
            ref="headerControls"
            nextAction={this._onClickNextWeek}
            prevAction={this._onClickPrevWeek}
          >
            <button
              key="today"
              className="btn"
              ref="todayBtn"
              onClick={this._onClickToday}
              style={{ position: 'absolute', left: 10 }}
            >
              Today
            </button>
          </HeaderControls>

          <div className="calendar-body-wrap">
            <div className="calendar-legend">
              <div
                className="date-label-legend"
                style={{ height: this._allDayEventHeight(allDayOverlap) + 75 + 1 }}
              >
                <span className="legend-text">All Day</span>
              </div>
              <div className="event-grid-legend-wrap" ref="eventGridLegendWrap">
                <div className="event-grid-legend" style={{ height: gridHeight }}>
                  {this._renderEventGridLabels()}
                </div>
              </div>
            </div>

            <div
              className="calendar-area-wrap"
              ref="calendarAreaWrap"
              onWheel={this._onScrollCalendarArea}
            >
              <div className="week-header" style={{ width: `${this._bufferRatio() * 100}%` }}>
                <div className="date-labels">{days.map(this._renderDateLabel)}</div>

                <WeekViewAllDayEvents
                  ref="weekViewAllDayEvents"
                  minorDim={MIN_INTERVAL_HEIGHT}
                  end={endMoment.unix()}
                  height={this._allDayEventHeight(allDayOverlap)}
                  start={startMoment.unix()}
                  allDayEvents={eventsByDay.allDay}
                  allDayOverlap={allDayOverlap}
                />
              </div>
              <ScrollRegion
                className="event-grid-wrap"
                ref="eventGridWrap"
                getScrollbar={() => this.refs.scrollbar}
                onScroll={this._onScrollGrid}
                style={{ width: `${this._bufferRatio() * 100}%` }}
              >
                <div className="event-grid" style={{ height: gridHeight }}>
                  {days.map(_.partial(this._renderEventColumn, eventsByDay))}
                  <CurrentTimeIndicator
                    visible={
                      todayColumnIdx > BUFFER_DAYS && todayColumnIdx <= BUFFER_DAYS + DAYS_IN_VIEW
                    }
                    gridHeight={gridHeight}
                    numColumns={BUFFER_DAYS * 2 + DAYS_IN_VIEW}
                    todayColumnIdx={todayColumnIdx}
                  />
                  <EventGridBackground
                    height={gridHeight}
                    intervalHeight={this.state.intervalHeight}
                    numColumns={BUFFER_DAYS * 2 + DAYS_IN_VIEW}
                    ref="eventGridBg"
                    tickGenerator={tickGen}
                  />
                </div>
              </ScrollRegion>
            </div>
            <ScrollRegion.Scrollbar
              ref="scrollbar"
              getScrollRegion={() => this.refs.eventGridWrap}
            />
          </div>
        </CalendarEventContainer>
      </div>
    );
  }
}
