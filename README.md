# NWWT Market Scanner

NWWT Market Scanner is a real time cryptocurrency market analysis platform built around live market data, watchlists, charts, market structure analysis, signal detection, and performance tracking

## purpose

the goal of this project is to analyze live market conditions and identify potential trading setups using market structure and price action

the system is designed to analyze setups rather than blindly generate signals

## core system

the scanner analyzes

- live market prices
- candlestick data
- market structure
- swing highs
- swing lows
- trend direction
- support and resistance
- break of structure
- change of character
- break and retest
- fakeouts
- rejection candles
- continuation candles
- setup type
- timeframe
- trade direction
- entry conditions
- take profit conditions
- stop loss conditions

## signal process

the system follows this general process

live market data

↓

market structure analysis

↓

existing strategy detection

↓

setup confirmation

↓

market condition analysis

↓

signal filtering

↓

final signal

↓

trade monitoring

↓

tp or sl result

↓

performance tracking

## market structure intelligence

the market structure layer is designed to determine the current state of the market before allowing a setup to become a final signal

possible market conditions include

- trending up
- trending down
- ranging
- high volatility
- low volatility
- transition

the system should use only information available at the time a signal is generated

future candles must never be used to determine a historical signal

## ai analysis layer

the project includes an ai assisted analysis layer designed to evaluate existing setups

the ai should not randomly create trades

instead it should evaluate whether the current setup agrees with the current market structure

the ai can return

- allow
- reject
- wait

the ai analysis may consider

- market structure
- trend
- support and resistance
- setup type
- timeframe
- direction
- recent price behavior
- market regime
- entry location
- tp distance
- sl distance
- historical setup performance

## adaptive performance system

every completed signal should be recorded

each result should contain information such as

- asset
- timeframe
- direction
- setup type
- market condition
- structure state
- entry
- take profit
- stop loss
- result
- duration
- confidence
- conditions present when the signal was created

when tp or sl is reached, the trade becomes settled

settled results are then used for performance analysis

## performance metrics

the system should track

- total trades
- wins
- losses
- win rate
- average win
- average loss
- profit factor
- expectancy
- drawdown
- maximum losing streak
- sample size

performance should also be separated by

- setup type
- direction
- timeframe
- market condition
- strategy mode

## strategy comparison

the scanner can compare multiple analysis modes

### original

uses the existing strategy direction

### inverse

tests the opposite direction of the existing strategy

### ai filtered

uses the existing strategy with the ai market structure filter

### ai inverse

tests the inverse strategy with the ai filter

inverse results are for research and comparison

they must not automatically replace the original strategy

## learning rules

the system must not modify historical results

the system must not use future information when making past decisions

the system must not assume that a losing signal should automatically be reversed

the system must collect enough data before changing how a setup is filtered

one or two trades should not cause the strategy to change behavior

recent performance may be given more weight than very old performance while still maintaining historical statistics

## validation

the adaptive system should use walk forward validation

training information must always come before validation information

future trade results must never influence earlier signals

the purpose of validation is to determine whether improvements continue to work on unseen market data

## live scanner

the scanner should support

- live market monitoring
- multiple assets
- selectable timeframes
- manual market scanning
- currently selected asset scanning
- real time signal tracking
- completed trade tracking
- performance statistics

## chart

the chart should

- display live price movement
- support multiple timeframes
- show market structure when enabled
- display relevant setup information
- remain compact by default
- provide a full screen chart option
- work correctly on mobile devices

## mobile interface

the interface must remain usable on smaller screens

all panels should remain accessible

dropdowns should scroll when necessary

content should never be cut off

navigation should never overlap important information

large empty containers should not remain on the page

## interface rules

the public interface should show what the product does

the public interface should not expose how the product was built

do not display

- api keys
- private credentials
- websocket implementation details
- internal function names
- internal strategy implementation
- development debugging information
- provider connection details
- unnecessary backend information

## security

never place private api keys or credentials directly inside client side code

use environment variables or secure server side configuration for sensitive credentials

do not treat hidden ui elements as security

sensitive credentials must never be exposed through the frontend

## development principle

preserve existing working functionality when adding new features

do not replace the live market connection unless specifically required

do not remove existing strategy logic unless specifically requested

new intelligence layers should be added on top of the existing system

all performance changes should be measurable

the objective is not to make the dashboard look profitable

the objective is to determine which setups and market conditions actually perform and improve the filtering process using measurable results

## disclaimer

this project is a market analysis and research tool

signals and analysis are not financial advice

trading involves risk and past performance does not guarantee future results

## project status

NWWT Market Scanner is actively being developed

features and analysis models may change as additional market data is collected and tested
