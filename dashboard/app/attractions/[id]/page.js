import RideDetailPage from "../../components/RideDetailPage";

export default async function Page({ params }) {
  const { id } = await params;
  return <RideDetailPage rideId={id}/>;
}
